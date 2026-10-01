import { canAccessJob, json } from '@/lib/access';
import { deterministicSummary, summaryPrompt, type SummaryContext } from '@/lib/ai/briefing';
import { generateWithFailover, type ProviderName } from '@/lib/ai/failover';
import { one, rows } from '@/lib/data';
import { effectivePath, nearestCity, pointAtProgress } from '@/lib/geo';
import { getSessions } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { City, Driver, JobCard, Shipment, VehicleType } from '@/lib/types';
import { fetchWeather } from '@/lib/weather';

// Edge runtime: LLM calls can be slow, and Edge functions are not subject to
// the serverless function timeout that would otherwise cut them off.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/** POST { jobCardId, simulateOutage? } -> AI goods and route description, saved on the Job Card. */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return json({ ok: false, message: 'Supabase is not configured.' }, 503);
    const sessions = await getSessions();
    if (sessions.length === 0) return json({ ok: false, message: 'Not signed in.' }, 401);

    const body = (await request.json().catch(() => ({}))) as { jobCardId?: string; simulateOutage?: ProviderName[] };
    if (!body.jobCardId) return json({ ok: false, message: 'jobCardId is required.' }, 400);

    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', body.jobCardId));
    if (!job) return json({ ok: false, message: 'Job Card not found.' }, 404);
    const [shipment, driver, cities] = await Promise.all([
      one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id)),
      one<Driver>(db.from('drivers').select('*').eq('id', job.driver_id)),
      rows<City>(db.from('cities').select('*')),
    ]);
    if (!shipment || !driver) return json({ ok: false, message: 'Shipment not found.' }, 404);
    if (!sessions.some((s) => canAccessJob(s, job, shipment))) return json({ ok: false, message: 'Not allowed.' }, 403);
    const vehicle = await one<VehicleType>(db.from('vehicle_types').select('*').eq('id', driver.vehicle_type));

    // Weather where the truck is heading next and at the destination.
    const path = effectivePath(job);
    const ahead = pointAtProgress(path, Math.min(1, Number(job.progress) + 0.15));
    const aheadCity = nearestCity(ahead, cities)?.city.name ?? shipment.origin_city;
    const end = job.waypoints[job.waypoints.length - 1] ?? ahead;
    const weather = await Promise.all([
      fetchWeather(ahead.lat, ahead.lng, aheadCity),
      fetchWeather(end.lat, end.lng, shipment.dest_city),
    ]);

    const context: SummaryContext = {
      category: shipment.goods_category,
      goods: shipment.goods_description,
      weight_kg: shipment.weight_kg,
      origin: shipment.origin_city,
      dest: shipment.dest_city,
      via: job.waypoints.filter((w) => w.kind === 'via' || w.kind === 'detour').map((w) => w.name),
      vehicle: vehicle?.name ?? 'Truck',
      routing_note: vehicle?.routing_note ?? '',
      distance_km: Number(job.distance_km),
      duration_min: job.duration_min,
      backhaul: job.is_backhaul,
      weather: aheadCity === shipment.dest_city ? [weather[1]] : weather,
    };

    const result = await generateWithFailover(summaryPrompt(context), () => deterministicSummary(context), {
      simulateOutage: sessions.some((s) => s.role === 'admin') ? body.simulateOutage : undefined,
    });

    await rows(db.from('job_cards').update({ ai_summary: result.text, ai_provider: result.provider }).eq('id', job.id).select('id'));
    return json({ ok: true, ...result });
  } catch (err) {
    // Never surface a crash to the demo: the Job Card keeps its existing briefing.
    return json({ ok: false, message: err instanceof Error ? err.message : 'AI briefing failed.' }, 200);
  }
}
