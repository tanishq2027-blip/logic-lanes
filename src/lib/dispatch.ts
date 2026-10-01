import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deterministicSummary, kg } from './ai/briefing';
import { LIVE_JOB_STATUSES, getReference, one, rows, type Reference } from './data';
import { dateShort } from './format';
import { rankDrivers, type LiveJob, type Match } from './matching';
import { quote } from './pricing';
import { buildEstimatedRoute } from './routing';
import type { AppNotification, Client, Driver, JobCard, Shipment } from './types';

type Db = SupabaseClient;

export type NewNotification = Pick<AppNotification, 'recipient_role' | 'recipient_id' | 'kind' | 'title' | 'body'> & {
  shipment_id?: string | null;
  job_card_id?: string | null;
};

/**
 * Demo clock for a new trip. 1 = real time: the truck covers on the map exactly
 * what its speed says. The admin panel can raise it to fast-forward a demo.
 */
export const REAL_TIME = 1;

export async function notify(db: Db, items: NewNotification[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await db.from('notifications').insert(items);
  if (error) throw new Error(error.message);
}

/**
 * Create the Job Card that hands a shipment to a driver, re-price the shipment
 * (return-trip loads are cheaper) and tell both sides.
 * Full-time drivers are assigned outright; gig drivers receive an offer.
 */
export async function assignToDriver(
  db: Db,
  input: { shipment: Shipment; driver: Driver; match: Pick<Match, 'score' | 'reason' | 'backhaul'>; ref: Reference; accepted?: boolean },
): Promise<JobCard> {
  const { shipment, driver, match, ref } = input;
  const origin = ref.cities.find((c) => c.name === shipment.origin_city);
  const dest = ref.cities.find((c) => c.name === shipment.dest_city);
  const vehicle = ref.vehicles.find((v) => v.id === driver.vehicle_type);
  const client = await one<Client>(db.from('clients').select('*').eq('id', shipment.client_id));
  if (!origin || !dest || !vehicle || !client) throw new Error('Shipment references unknown city, vehicle or client.');
  const tier = ref.tiers.find((t) => t.id === client.membership_tier) ?? ref.tiers[0];

  const plan = buildEstimatedRoute(origin, dest, ref.cities, vehicle);
  // Freight is charged for the vehicle class the load needs, whatever truck ends up carrying it:
  // a client is not billed more because a bigger truck happened to be the one nearby.
  const billed = ref.vehicles.find((v) => v.id === shipment.vehicle_type) ?? vehicle;
  const price = quote({ distanceKm: plan.distance_km, weightKg: shipment.weight_kg, vehicle: billed, vehicles: ref.vehicles, tier, backhaul: match.backhaul });
  const assigned = driver.driver_type === 'full_time' || input.accepted === true;
  const now = new Date().toISOString();

  const summary = deterministicSummary({
    category: shipment.goods_category,
    goods: shipment.goods_description,
    weight_kg: shipment.weight_kg,
    origin: origin.name,
    dest: dest.name,
    via: plan.waypoints.filter((w) => w.kind === 'via').map((w) => w.name),
    vehicle: vehicle.name,
    routing_note: vehicle.routing_note,
    distance_km: plan.distance_km,
    duration_min: plan.duration_min,
    backhaul: match.backhaul,
    weather: [],
  });

  const job = await one<JobCard>(
    db
      .from('job_cards')
      .insert({
        shipment_id: shipment.id,
        driver_id: driver.id,
        status: assigned ? 'assigned' : 'offered',
        goods_summary: shipment.goods_description,
        ai_summary: summary,
        ai_provider: 'deterministic',
        waypoints: plan.waypoints,
        route_path: plan.route_path,
        steps: plan.steps,
        route_source: 'estimate',
        distance_km: plan.distance_km,
        duration_min: plan.duration_min,
        current_lat: origin.lat,
        current_lng: origin.lng,
        sim_multiplier: REAL_TIME,
        is_backhaul: match.backhaul,
        match_score: match.score,
        match_reason: match.reason,
        offered_at: now,
        accepted_at: assigned ? now : null,
      })
      .select('*'),
  );
  if (!job) throw new Error('Could not create the Job Card.');

  await rows(
    db
      .from('shipments')
      .update({
        status: assigned ? 'assigned' : 'offered',
        is_backhaul: match.backhaul,
        distance_km: plan.distance_km,
        quoted_price_inr: price.price_inr,
        discount_pct: price.discount_pct,
      })
      .eq('id', shipment.id)
      .select('id'),
  );

  const lane = `${shipment.origin_city} to ${shipment.dest_city}`;
  await notify(db, [
    {
      recipient_role: 'driver',
      recipient_id: driver.id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: assigned ? (match.backhaul ? 'backhaul' : 'assignment') : 'offer',
      title: assigned ? `New ${match.backhaul ? 'return-trip load' : 'assignment'}: ${lane}` : `New job offer: ${lane}`,
      body: assigned
        ? `${kg(shipment.weight_kg)}, pickup ${dateShort(shipment.pickup_date)}. Tap Start trip when loaded.`
        : `${kg(shipment.weight_kg)}, pickup ${dateShort(shipment.pickup_date)}. Accept or reject from your dashboard.`,
    },
    {
      recipient_role: 'client',
      recipient_id: shipment.client_id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: assigned ? 'assignment' : 'info',
      title: assigned ? `Driver assigned to ${shipment.reference}` : `${shipment.reference} offered to a driver`,
      body: assigned
        ? `${driver.name} (${driver.vehicle_number}, ${vehicle.name}) will carry your load.${match.backhaul ? ' Return-trip match: your freight is cheaper.' : ''}`
        : `We offered your load to ${driver.name}. You will be notified when it is accepted.`,
    },
  ]);

  return job;
}

/**
 * Automated dispatch: rank every driver for the shipment and hand it to the
 * best one. If nobody fits, the shipment stays `pending` and is advertised to
 * trucks arriving in its origin city as a return-trip load.
 */
export async function dispatchShipment(
  db: Db,
  shipment: Shipment,
  options: { exclude?: string[] } = {},
): Promise<{ job: JobCard | null; match: Match | null }> {
  const [ref, drivers, jobs] = await Promise.all([
    getReference(db),
    rows<Driver>(db.from('drivers').select('*')),
    rows<JobCard>(db.from('job_cards').select('*').in('status', [...LIVE_JOB_STATUSES])),
  ]);
  const jobShipments = jobs.length
    ? await rows<Shipment>(db.from('shipments').select('*').in('id', [...new Set(jobs.map((j) => j.shipment_id))]))
    : [];
  const liveJobs: LiveJob[] = jobs.flatMap((j) => {
    const s = jobShipments.find((x) => x.id === j.shipment_id);
    return s ? [{ ...j, shipment: s }] : [];
  });

  const [best] = rankDrivers({ shipment, drivers, vehicles: ref.vehicles, cities: ref.cities, liveJobs, exclude: options.exclude });

  if (!best) {
    await rows(db.from('shipments').update({ status: 'pending' }).eq('id', shipment.id).select('id'));
    await notify(db, [
      {
        recipient_role: 'client',
        recipient_id: shipment.client_id,
        shipment_id: shipment.id,
        kind: 'info',
        title: `${shipment.reference}: finding a truck`,
        body: `No truck is free near ${shipment.origin_city} yet. Your load is advertised to trucks arriving there and you will be notified the moment one takes it.`,
      },
    ]);
    return { job: null, match: null };
  }

  const job = await assignToDriver(db, { shipment, driver: best.driver, match: best, ref });
  return { job, match: best };
}

/** Driver delivered: close the Job Card and shipment, free the driver, tell the client. */
export async function completeDelivery(db: Db, job: JobCard): Promise<void> {
  const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
  const driver = await one<Driver>(db.from('drivers').select('*').eq('id', job.driver_id));
  if (!shipment || !driver) return;
  const now = new Date().toISOString();
  const end = job.waypoints[job.waypoints.length - 1];

  // Only the request that actually flips the status sends the notifications.
  const flipped = await rows<JobCard>(
    db
      .from('job_cards')
      .update({
        status: 'delivered',
        progress: 1,
        speed_kmph: 0,
        current_lat: end?.lat ?? job.current_lat,
        current_lng: end?.lng ?? job.current_lng,
        delivered_at: now,
        eta: now,
        last_telemetry_at: now,
      })
      .eq('id', job.id)
      .eq('status', 'in_transit')
      .select('id'),
  );
  if (flipped.length === 0) return;

  await rows(db.from('shipments').update({ status: 'delivered' }).eq('id', shipment.id).select('id'));
  await rows(
    db
      .from('drivers')
      .update({
        status: 'available',
        current_city: shipment.dest_city,
        current_lat: end?.lat ?? driver.current_lat,
        current_lng: end?.lng ?? driver.current_lng,
        trips_completed: driver.trips_completed + 1,
      })
      .eq('id', driver.id)
      .select('id'),
  );

  const next = await one<JobCard>(db.from('job_cards').select('*').eq('driver_id', driver.id).eq('status', 'assigned').limit(1));
  await notify(db, [
    {
      recipient_role: 'client',
      recipient_id: shipment.client_id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'delivered',
      title: `${shipment.reference} delivered`,
      body: `Your load reached ${shipment.dest_city}. Delivered by ${driver.name}.`,
    },
    {
      recipient_role: 'driver',
      recipient_id: driver.id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'delivered',
      title: `${shipment.reference} delivered`,
      body: next
        ? 'Well done. Your return-trip load is ready: tap Start trip when loaded.'
        : `Well done. You are now marked available in ${shipment.dest_city}.`,
    },
  ]);
}
