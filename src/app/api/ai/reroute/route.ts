import { json } from '@/lib/access';
import { INCIDENT_LABEL, advisoryPrompt, deterministicAdvisory, type RerouteContext } from '@/lib/ai/briefing';
import { generateWithFailover, type ProviderName } from '@/lib/ai/failover';
import { one, rows } from '@/lib/data';
import { notify } from '@/lib/dispatch';
import { planReroute } from '@/lib/routing';
import { getSessions } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { City, Driver, IncidentType, JobCard, Shipment, VehicleType } from '@/lib/types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const TYPES: IncidentType[] = ['accident', 'traffic', 'weather', 'road_closure'];
/** Minutes lost at the incident itself, per severity level, before the detour's extra distance. */
const BASE_DELAY_MIN = 15;

type Body = {
  jobCardId?: string;
  type?: IncidentType;
  severity?: number;
  simulateOutage?: ProviderName[];
};

/**
 * POST -> live reroute, triggered from the admin panel. Computes the new route,
 * asks the LLM chain for the alert text, updates the Job Card and notifies the
 * driver and the client.
 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return json({ ok: false, message: 'Supabase is not configured.' }, 503);
    const sessions = await getSessions();
    if (sessions.length === 0) return json({ ok: false, message: 'Not signed in.' }, 401);

    const body = (await request.json().catch(() => ({}))) as Body;
    const type = TYPES.includes(body.type as IncidentType) ? (body.type as IncidentType) : null;
    if (!body.jobCardId || !type) return json({ ok: false, message: 'jobCardId and a valid type are required.' }, 400);
    const severity = Math.max(1, Math.min(3, Math.round(body.severity ?? 2)));
    const source = 'admin' as const;
    const isAdmin = sessions.some((s) => s.role === 'admin');

    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', body.jobCardId));
    if (!job) return json({ ok: false, message: 'Job Card not found.' }, 404);

    if (!isAdmin) {
      return json({ ok: false, message: 'Not allowed.' }, 403);
    }
    if (job.status !== 'in_transit') return json({ ok: false, message: 'Only a trip that is on the road can be rerouted.' });
    if (Number(job.progress) > 0.96) return json({ ok: false, message: 'The truck is almost at its destination.' });

    const [shipment, driver, cities] = await Promise.all([
      one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id)),
      one<Driver>(db.from('drivers').select('*').eq('id', job.driver_id)),
      rows<City>(db.from('cities').select('*')),
    ]);
    if (!shipment || !driver) return json({ ok: false, message: 'Shipment not found.' }, 404);
    const vehicle = await one<VehicleType>(db.from('vehicle_types').select('*').eq('id', driver.vehicle_type));
    if (!vehicle) return json({ ok: false, message: 'Vehicle type not found.' }, 404);

    // 1. New route (deterministic geometry; /api/route then refines it to real roads with OpenRouteService).
    const plan = planReroute(job, cities, vehicle);
    // Rounded to 5 minutes: it is an estimate, and the alert text and the Job Card must agree.
    const delay_min = Math.round(((plan.added_km / vehicle.avg_speed_kmph) * 60 + severity * BASE_DELAY_MIN) / 5) * 5;
    const remainingKm = (1 - plan.progress) * plan.distance_km;
    const eta = new Date(Date.now() + ((remainingKm / vehicle.avg_speed_kmph) * 60 + severity * BASE_DELAY_MIN) * 60_000).toISOString();

    // 2. Alert text through the LLM failover chain.
    const context: RerouteContext = {
      reference: shipment.reference,
      incident: type,
      severity,
      near: plan.incident_near,
      detour: plan.detour_name,
      added_km: plan.added_km,
      delay_min,
      dest: shipment.dest_city,
      source,
    };
    const ai = await generateWithFailover(advisoryPrompt(context), () => deterministicAdvisory(context), {
      simulateOutage: isAdmin ? body.simulateOutage : undefined,
    });

    // 3. Persist: incident, new Job Card route, notifications.
    await rows(
      db
        .from('incidents')
        .insert({
          job_card_id: job.id,
          type,
          severity,
          description: ai.text,
          lat: plan.incident.lat,
          lng: plan.incident.lng,
          source,
          delay_min,
        })
        .select('id'),
    );
    await rows(
      db
        .from('job_cards')
        .update({
          waypoints: plan.waypoints,
          route_path: plan.route_path,
          steps: plan.steps,
          route_source: 'estimate',
          route_version: job.route_version + 1,
          distance_km: plan.distance_km,
          duration_min: plan.duration_min,
          progress: plan.progress,
          eta,
        })
        .eq('id', job.id)
        .select('id'),
    );

    const label = INCIDENT_LABEL[type];
    await notify(db, [
      {
        recipient_role: 'driver',
        recipient_id: driver.id,
        shipment_id: shipment.id,
        job_card_id: job.id,
        kind: 'reroute',
        title: `Route changed: ${label.toLowerCase()} near ${plan.incident_near}`,
        body: ai.text,
      },
      {
        recipient_role: 'client',
        recipient_id: shipment.client_id,
        shipment_id: shipment.id,
        job_card_id: job.id,
        kind: type === 'accident' ? 'incident' : type === 'traffic' ? 'delay' : 'reroute',
        title: `${shipment.reference}: ${label.toLowerCase()} ahead, truck rerouted`,
        body: ai.text,
      },
    ]);

    return json({ ok: true, advisory: ai.text, provider: ai.provider, attempts: ai.attempts, detour: plan.detour_name, delay_min });
  } catch (err) {
    return json({ ok: false, message: err instanceof Error ? err.message : 'Reroute failed.' }, 200);
  }
}
