import { json } from '@/lib/access';
import { RETURN_LOAD_PROGRESS, one, rows } from '@/lib/data';
import { completeDelivery, notify, type NewNotification } from '@/lib/dispatch';
import { effectivePath, pointAtProgress } from '@/lib/geo';
import { getSessions } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { Client, Driver, JobCard, MembershipTier, Shipment, VehicleType } from '@/lib/types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/** A tick never advances a truck by more than this much real time, so a demo left closed overnight resumes where it stopped. */
const MAX_STEP_SEC = 15;
const MIN_STEP_SEC = 3;
/** Within this distance of a town on the route the truck drives at town speed. */
const TOWN_RADIUS_KM = 9;

/**
 * POST -> advance the telemetry of every truck on the road.
 *
 * Open dashboards call this every few seconds. Movement is derived from the
 * time since each Job Card's last telemetry write, so it does not matter how
 * many dashboards are calling: a conditional update lets exactly one win.
 */
export async function POST() {
  try {
    if (!isSupabaseConfigured()) return json({ ok: false, advanced: 0 });
    if ((await getSessions()).length === 0) return json({ ok: false, advanced: 0 }, 401);

    const db = getDb();
    const jobs = await rows<JobCard>(db.from('job_cards').select('*').eq('status', 'in_transit').gt('sim_multiplier', 0));
    if (jobs.length === 0) return json({ ok: true, advanced: 0 });

    const [drivers, vehicles] = await Promise.all([
      rows<Driver>(db.from('drivers').select('*').in('id', [...new Set(jobs.map((j) => j.driver_id))])),
      rows<VehicleType>(db.from('vehicle_types').select('*')),
    ]);

    let advanced = 0;
    for (const job of jobs) {
      const now = Date.now();
      const elapsed = Math.min(MAX_STEP_SEC, (now - new Date(job.last_telemetry_at).getTime()) / 1000);
      if (elapsed < MIN_STEP_SEC) continue;

      const driver = drivers.find((d) => d.id === job.driver_id);
      const vehicle = vehicles.find((v) => v.id === driver?.vehicle_type);
      const cruise = vehicle?.avg_speed_kmph ?? 45;
      const distanceKm = Number(job.distance_km) || 1;
      const from = Number(job.progress);
      // `avg_speed_kmph` is a whole-trip average that includes slow stretches. On the open highway
      // a truck runs faster than that; within a few km of a town on the route it slows right down.
      const nearTown = job.waypoints.some((w) => Math.abs(w.at - from) * distanceKm < TOWN_RADIUS_KM);
      const wobble = 3 * Math.sin(now / 17_000) + 1.5 * Math.sin(now / 5_300);
      const speed = Math.round(nearTown ? cruise * 0.62 + wobble : cruise * 1.18 + wobble);
      const to = Math.min(1, from + (speed * (elapsed / 3600) * job.sim_multiplier) / distanceKm);

      if (to >= 1) {
        await completeDelivery(db, job);
        advanced++;
        continue;
      }

      const position = pointAtProgress(effectivePath(job), to);
      const remainingKm = (1 - to) * distanceKm;
      const updated = await rows<JobCard>(
        db
          .from('job_cards')
          .update({
            progress: Math.round(to * 1e5) / 1e5,
            current_lat: position.lat,
            current_lng: position.lng,
            speed_kmph: speed,
            eta: new Date(now + (remainingKm / cruise) * 3_600_000).toISOString(),
            last_telemetry_at: new Date(now).toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'in_transit')
          .lt('last_telemetry_at', new Date(now - (MIN_STEP_SEC - 0.5) * 1000).toISOString())
          .select('id'),
      );
      if (updated.length === 0) continue; // another dashboard advanced it first
      advanced++;

      if (driver) {
        await rows(db.from('drivers').update({ current_lat: position.lat, current_lng: position.lng, current_city: null }).eq('id', driver.id).select('id'));
      }
      await milestones(db, job, from, to, remainingKm);
    }
    return json({ ok: true, advanced });
  } catch (err) {
    return json({ ok: false, advanced: 0, message: err instanceof Error ? err.message : 'Tick failed.' });
  }
}

/** Notifications for things the truck passed during this step. */
async function milestones(db: ReturnType<typeof getDb>, job: JobCard, from: number, to: number, remainingKm: number) {
  const crossed = job.waypoints.filter((w) => (w.kind === 'via' || w.kind === 'detour') && w.at > from && w.at <= to);
  const nearing = from < RETURN_LOAD_PROGRESS && to >= RETURN_LOAD_PROGRESS;
  if (crossed.length === 0 && !nearing) return;

  const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
  if (!shipment) return;
  const items: NewNotification[] = [];

  if (crossed.length > 0) {
    // City-by-city milestones are a paid-tier perk.
    const client = await one<Client>(db.from('clients').select('*').eq('id', shipment.client_id));
    const tier = client ? await one<MembershipTier>(db.from('membership_tiers').select('*').eq('id', client.membership_tier)) : null;
    if (tier && tier.priority >= 1) {
      const last = crossed[crossed.length - 1];
      items.push({
        recipient_role: 'client',
        recipient_id: shipment.client_id,
        shipment_id: shipment.id,
        job_card_id: job.id,
        kind: 'milestone',
        title: `${shipment.reference} crossed ${last.name}`,
        body: `On the move. About ${Math.round(remainingKm)} km left to ${shipment.dest_city}.`,
      });
    }
  }

  if (nearing) {
    const open = await rows<Shipment>(db.from('shipments').select('*').eq('status', 'pending').eq('origin_city', shipment.dest_city).limit(5));
    if (open.length > 0) {
      items.push({
        recipient_role: 'driver',
        recipient_id: job.driver_id,
        shipment_id: shipment.id,
        job_card_id: job.id,
        kind: 'backhaul',
        title: `Return loads waiting in ${shipment.dest_city}`,
        body: `${open.length} load${open.length === 1 ? ' is' : 's are'} leaving ${shipment.dest_city} after you arrive. Pick one so you do not drive back empty.`,
      });
    }
  }
  await notify(db, items);
}
