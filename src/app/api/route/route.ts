import { canAccessJob, json } from '@/lib/access';
import { one, rows } from '@/lib/data';
import { fetchRoadRoute } from '@/lib/ors';
import { applyRoadRoute } from '@/lib/roadRoute';
import { routingProfile } from '@/lib/routing';
import { getSessions } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { City, Driver, JobCard, Shipment, VehicleType } from '@/lib/types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * POST { jobCardId } -> fetch the real road route for a Job Card from
 * OpenRouteService and store it on the card.
 *
 * The map calls this once per route version (a new job, or after a reroute).
 * Origin, destination and detour points are read from the database, never
 * from the request, so a caller cannot plant a route of their own.
 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return json({ ok: false, reason: 'not_configured' }, 503);
    const sessions = await getSessions();
    if (sessions.length === 0) return json({ ok: false, reason: 'not_signed_in' }, 401);

    const body = (await request.json().catch(() => ({}))) as { jobCardId?: string };
    if (!body.jobCardId) return json({ ok: false, reason: 'bad_request' }, 400);

    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', body.jobCardId));
    if (!job) return json({ ok: false, reason: 'not_found' }, 404);
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
    if (!shipment || !sessions.some((s) => canAccessJob(s, job, shipment))) return json({ ok: false, reason: 'not_allowed' }, 403);

    // Already on real roads, or nothing to route.
    if (job.route_source !== 'estimate' || job.waypoints.length < 2) return json({ ok: true, changed: false });

    const [driver, cities] = await Promise.all([
      one<Driver>(db.from('drivers').select('*').eq('id', job.driver_id)),
      rows<City>(db.from('cities').select('*')),
    ]);
    const vehicle = driver ? await one<VehicleType>(db.from('vehicle_types').select('*').eq('id', driver.vehicle_type)) : null;
    if (!vehicle) return json({ ok: false, reason: 'not_found' }, 404);

    // Origin, any detours in travel order, destination. Ordinary via-towns are
    // left out so the router is free to choose the best road between the ends.
    const origin = job.waypoints[0];
    const dest = job.waypoints[job.waypoints.length - 1];
    const detours = job.waypoints.filter((w) => w.kind === 'detour').sort((a, b) => a.at - b.at);
    const points = [origin, ...detours, dest].map((w) => ({ lat: w.lat, lng: w.lng }));

    const result = await fetchRoadRoute(points, routingProfile(vehicle));
    if ('error' in result) return json({ ok: false, reason: result.error });

    const changed = await applyRoadRoute(db, job, cities, result.route);
    return json({ ok: true, changed });
  } catch (err) {
    // The estimated route stays on screen; the map never depends on this call.
    return json({ ok: false, reason: 'unavailable', message: err instanceof Error ? err.message : undefined });
  }
}
