'use server';

import { revalidatePath } from 'next/cache';
import { OPEN_LOAD_RADIUS_KM, getReference, one, rows } from '@/lib/data';
import { assignToDriver, completeDelivery, dispatchShipment, notify } from '@/lib/dispatch';
import { ROAD_FACTOR, effectivePath, haversineKm, pointAtProgress } from '@/lib/geo';
import { getSession, type Session } from '@/lib/session';
import { DASHBOARD } from '@/lib/supabase/cookies';
import { closeSos, raiseSos } from '@/lib/sos';
import { getDb } from '@/lib/supabase/server';
import type { Driver, JobCard, Shipment } from '@/lib/types';

export type ActionResult = { ok: boolean; message: string };

async function driverSession(): Promise<Session | null> {
  return getSession('driver');
}

function fail(err: unknown, fallback: string): ActionResult {
  const message = err instanceof Error ? err.message : fallback;
  // Two trucks took the same load at the same moment: the database lets only one through.
  if (message.includes('job_cards_one_live_per_shipment')) return { ok: false, message: 'Another truck has just taken this load.' };
  return { ok: false, message };
}

/** Gig drivers: accept or reject an offered job. A rejected load is re-dispatched to the next best driver. */
export async function respondToOffer(jobId: string, accept: boolean): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId).eq('driver_id', session.id));
    if (!job || job.status !== 'offered') return { ok: false, message: 'This offer is no longer open.' };
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
    if (!shipment) return { ok: false, message: 'Shipment not found.' };

    if (accept) {
      await rows(db.from('job_cards').update({ status: 'assigned', accepted_at: new Date().toISOString() }).eq('id', job.id).select('id'));
      await rows(db.from('shipments').update({ status: 'assigned' }).eq('id', shipment.id).select('id'));
      await notify(db, [
        {
          recipient_role: 'client',
          recipient_id: shipment.client_id,
          shipment_id: shipment.id,
          job_card_id: job.id,
          kind: 'assignment',
          title: `Driver confirmed for ${shipment.reference}`,
          body: `${session.name} accepted your load from ${shipment.origin_city} to ${shipment.dest_city}.`,
        },
      ]);
      revalidatePath(DASHBOARD.driver);
      return { ok: true, message: 'Job accepted. Tap Start trip when the truck is loaded.' };
    }

    await rows(db.from('job_cards').update({ status: 'rejected' }).eq('id', job.id).select('id'));
    const declined = await rows<JobCard>(db.from('job_cards').select('*').eq('shipment_id', shipment.id).eq('status', 'rejected'));
    const next = await dispatchShipment(db, { ...shipment, status: 'pending' }, { exclude: declined.map((j) => j.driver_id) });
    revalidatePath(DASHBOARD.driver);
    return {
      ok: true,
      message: next.match
        ? `Job rejected. It has been passed to ${next.match.driver.name}.`
        : 'Job rejected. No other truck is free yet, so the load is back on the open board.',
    };
  } catch (err) {
    return fail(err, 'Could not update the offer.');
  }
}

export async function startTrip(jobId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId).eq('driver_id', session.id));
    if (!job || job.status !== 'assigned') return { ok: false, message: 'This job cannot be started.' };
    const running = await rows<JobCard>(db.from('job_cards').select('*').eq('driver_id', session.id).eq('status', 'in_transit'));
    if (running.length > 0) return { ok: false, message: 'Finish your current trip first.' };
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
    if (!shipment) return { ok: false, message: 'Shipment not found.' };

    const now = Date.now();
    const start = pointAtProgress(effectivePath(job), 0);
    await rows(
      db
        .from('job_cards')
        .update({
          status: 'in_transit',
          progress: 0,
          current_lat: start.lat,
          current_lng: start.lng,
          started_at: new Date(now).toISOString(),
          last_telemetry_at: new Date(now).toISOString(),
          eta: new Date(now + job.duration_min * 60_000).toISOString(),
        })
        .eq('id', job.id)
        .select('id'),
    );
    await rows(db.from('shipments').update({ status: 'in_transit' }).eq('id', shipment.id).select('id'));
    await rows(db.from('drivers').update({ status: 'on_trip' }).eq('id', session.id).select('id'));
    await notify(db, [
      {
        recipient_role: 'client',
        recipient_id: shipment.client_id,
        shipment_id: shipment.id,
        job_card_id: job.id,
        kind: 'info',
        title: `${shipment.reference} picked up`,
        body: `${session.name} left ${shipment.origin_city} with your load. Track it live on your dashboard.`,
      },
    ]);
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: 'Trip started. Drive safely.' };
  } catch (err) {
    return fail(err, 'Could not start the trip.');
  }
}

export async function markDelivered(jobId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId).eq('driver_id', session.id));
    if (!job || job.status !== 'in_transit') return { ok: false, message: 'This trip is not on the road.' };
    await completeDelivery(db, job);
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: 'Delivery recorded. Thank you.' };
  } catch (err) {
    return fail(err, 'Could not record the delivery.');
  }
}

/** Driver takes an open load leaving the city they are about to reach, so the truck does not return empty. */
export async function acceptReturnLoad(shipmentId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const [driver, shipment, ref, jobs] = await Promise.all([
      one<Driver>(db.from('drivers').select('*').eq('id', session.id)),
      one<Shipment>(db.from('shipments').select('*').eq('id', shipmentId)),
      getReference(db),
      rows<JobCard>(db.from('job_cards').select('*').eq('driver_id', session.id).in('status', ['offered', 'assigned', 'in_transit'])),
    ]);
    if (!driver || !shipment) return { ok: false, message: 'Load not found.' };
    if (shipment.status !== 'pending') return { ok: false, message: 'Another truck has just taken this load.' };
    const active = jobs.find((j) => j.status === 'in_transit');
    if (!active) return { ok: false, message: 'Return loads can be taken while you are on a trip.' };
    if (jobs.length > 1) return { ok: false, message: 'You already have a job lined up after this trip.' };
    const activeShipment = await one<Shipment>(db.from('shipments').select('*').eq('id', active.shipment_id));
    if (!activeShipment || activeShipment.dest_city !== shipment.origin_city) {
      return { ok: false, message: 'This load does not start where your trip ends.' };
    }
    const vehicle = ref.vehicles.find((v) => v.id === driver.vehicle_type);
    if (!vehicle || vehicle.capacity_kg < shipment.weight_kg) return { ok: false, message: 'This load is too heavy for your truck.' };

    await assignToDriver(db, {
      shipment,
      driver,
      ref,
      accepted: true,
      match: {
        score: 130,
        backhaul: true,
        reason: `Picked by the driver as a return-trip load: finishing a delivery in ${shipment.origin_city}, 0 km empty run to pickup.`,
      },
    });
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: `Return load ${shipment.reference} is yours. It starts after this delivery.` };
  } catch (err) {
    return fail(err, 'Could not take the return load.');
  }
}

/** An idle driver takes an open load from the board. The shipment becomes 'assigned' and gets its Job Card. */
export async function acceptOpenLoad(shipmentId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const [driver, shipment, ref, jobs] = await Promise.all([
      one<Driver>(db.from('drivers').select('*').eq('id', session.id)),
      one<Shipment>(db.from('shipments').select('*').eq('id', shipmentId)),
      getReference(db),
      rows<JobCard>(db.from('job_cards').select('*').eq('driver_id', session.id).in('status', ['assigned', 'in_transit'])),
    ]);
    if (!driver || !shipment) return { ok: false, message: 'Load not found.' };
    if (shipment.status !== 'pending') return { ok: false, message: 'Another truck has just taken this load.' };
    if (jobs.length > 0) return { ok: false, message: 'You already have a job. Finish it before taking another load.' };

    const vehicle = ref.vehicles.find((v) => v.id === driver.vehicle_type);
    if (!vehicle || vehicle.capacity_kg < shipment.weight_kg) return { ok: false, message: 'This load is too heavy for your truck.' };
    const origin = ref.cities.find((c) => c.name === shipment.origin_city);
    const based = ref.cities.find((c) => c.name === (driver.current_city ?? driver.home_city));
    const position = driver.current_lat != null && driver.current_lng != null ? { lat: driver.current_lat, lng: driver.current_lng } : based;
    if (!origin || !position) return { ok: false, message: 'Pickup city not found.' };
    const pickupKm = Math.round(haversineKm(position, origin) * ROAD_FACTOR);
    if (pickupKm > OPEN_LOAD_RADIUS_KM) return { ok: false, message: `This pickup is ${pickupKm} km away, too far for an empty run.` };

    const towardsHome = shipment.dest_city === driver.home_city && shipment.origin_city !== driver.home_city;
    await assignToDriver(db, {
      shipment,
      driver,
      ref,
      accepted: true,
      match: {
        score: 110,
        backhaul: towardsHome,
        reason: `Accepted by the driver from the open board: ${pickupKm < 25 ? 0 : pickupKm} km empty run to pickup${towardsHome ? ', and the load takes the truck home' : ''}.`,
      },
    });
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: `${shipment.reference} is yours. Tap Start trip when the truck is loaded.` };
  } catch (err) {
    return fail(err, 'Could not take the load.');
  }
}

/** Not interested: remember it, so this load is not shown to this driver again. */
export async function declineOpenLoad(shipmentId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', shipmentId));
    if (!shipment) return { ok: false, message: 'Load not found.' };
    const already = await rows<{ id: string }>(
      db.from('job_cards').select('id').eq('shipment_id', shipment.id).eq('driver_id', session.id).eq('status', 'rejected').limit(1),
    );
    if (already.length === 0) {
      // A rejected Job Card is how the app records "this driver said no to this shipment".
      await rows(
        db
          .from('job_cards')
          .insert({ shipment_id: shipment.id, driver_id: session.id, status: 'rejected', goods_summary: shipment.goods_description, match_reason: 'Declined from the open board.' })
          .select('id'),
      );
    }
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: 'Load rejected. It will not be shown to you again.' };
  } catch (err) {
    return fail(err, 'Could not reject the load.');
  }
}

export type SosResult = ActionResult & {
  /** False when the alert went out but the flag could not be stored (supabase/upgrade.sql not run yet). */
  recorded?: boolean;
};

/**
 * The driver confirmed an emergency on their running trip. Alerts the client
 * and the control room in the app. It does not contact emergency services.
 */
export async function triggerSos(jobId: string): Promise<SosResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId).eq('driver_id', session.id));
    if (!job || job.status !== 'in_transit') return { ok: false, message: 'SOS is available while a trip is on the road.' };
    const [driver, shipment] = await Promise.all([
      one<Driver>(db.from('drivers').select('*').eq('id', session.id)),
      one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id)),
    ]);
    if (!driver || !shipment) return { ok: false, message: 'Trip not found.' };

    const { recorded } = await raiseSos(db, job, driver, shipment);
    revalidatePath(DASHBOARD.driver);
    return { ok: true, recorded, message: 'SOS Alert Broadcasted' };
  } catch (err) {
    return fail(err, 'Could not send the SOS. Call 112 now.');
  }
}

/** The driver is safe: close the SOS and let the trip continue. */
export async function clearSos(jobId: string): Promise<ActionResult> {
  try {
    const session = await driverSession();
    if (!session) return { ok: false, message: 'Please sign in as a driver again.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId).eq('driver_id', session.id));
    if (!job) return { ok: false, message: 'Trip not found.' };
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
    if (!shipment) return { ok: false, message: 'Trip not found.' };
    await closeSos(db, job, shipment, 'driver');
    revalidatePath(DASHBOARD.driver);
    return { ok: true, message: 'SOS cleared. The client has been told you are safe.' };
  } catch (err) {
    return fail(err, 'Could not clear the SOS.');
  }
}
