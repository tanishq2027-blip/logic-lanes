'use server';

import { revalidatePath } from 'next/cache';
import { one, rows } from '@/lib/data';
import { effectivePath, pointAtProgress } from '@/lib/geo';
import { getSession } from '@/lib/session';
import { closeSos } from '@/lib/sos';
import { getDb } from '@/lib/supabase/server';
import type { JobCard, Shipment } from '@/lib/types';
import type { ActionResult } from './driver';

async function isAdmin(): Promise<boolean> {
  return (await getSession('admin')) !== null;
}

const SPEEDS = [0, 1, 10, 60, 300];

/** Demo clock for one truck: 0 pauses it, 1 is real time, 60 means one real second is one minute of driving. */
export async function setSimSpeed(jobId: string, multiplier: number): Promise<ActionResult> {
  try {
    if (!(await isAdmin())) return { ok: false, message: 'Admin only.' };
    if (!SPEEDS.includes(multiplier)) return { ok: false, message: 'Unknown speed.' };
    const db = getDb();
    await rows(
      db.from('job_cards').update({ sim_multiplier: multiplier, last_telemetry_at: new Date().toISOString() }).eq('id', jobId).select('id'),
    );
    revalidatePath('/admin');
    return { ok: true, message: multiplier === 0 ? 'Truck paused.' : multiplier === 1 ? 'Truck is driving in real time.' : `Demo clock set to ${multiplier}x.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not change the speed.' };
  }
}

/** Put a truck back on the road at a chosen point of its route, so the demo can be replayed. */
export async function restartTrip(jobId: string, progress: number): Promise<ActionResult> {
  try {
    if (!(await isAdmin())) return { ok: false, message: 'Admin only.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId));
    if (!job || (job.status !== 'in_transit' && job.status !== 'delivered')) {
      return { ok: false, message: 'Only a running or delivered trip can be replayed.' };
    }
    const busy = await rows<JobCard>(db.from('job_cards').select('*').eq('driver_id', job.driver_id).eq('status', 'in_transit'));
    if (busy.some((j) => j.id !== job.id)) return { ok: false, message: 'This driver is already on another trip.' };

    const p = Math.max(0, Math.min(0.95, progress));
    const position = pointAtProgress(effectivePath(job), p);
    const now = Date.now();
    await rows(
      db
        .from('job_cards')
        .update({
          status: 'in_transit',
          progress: p,
          current_lat: position.lat,
          current_lng: position.lng,
          delivered_at: null,
          last_telemetry_at: new Date(now).toISOString(),
          eta: new Date(now + (1 - p) * job.duration_min * 60_000).toISOString(),
        })
        .eq('id', job.id)
        .select('id'),
    );
    await rows(db.from('shipments').update({ status: 'in_transit' }).eq('id', job.shipment_id).select('id'));
    await rows(
      db.from('drivers').update({ status: 'on_trip', current_city: null, current_lat: position.lat, current_lng: position.lng }).eq('id', job.driver_id).select('id'),
    );
    revalidatePath('/admin');
    return { ok: true, message: `Trip replaying from ${Math.round(p * 100)}%.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not restart the trip.' };
  }
}

/** The control room has dealt with a driver's SOS: close it and let the truck move again. */
export async function resolveSos(jobId: string): Promise<ActionResult> {
  try {
    if (!(await isAdmin())) return { ok: false, message: 'Admin only.' };
    const db = getDb();
    const job = await one<JobCard>(db.from('job_cards').select('*').eq('id', jobId));
    if (!job) return { ok: false, message: 'Trip not found.' };
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', job.shipment_id));
    if (!shipment) return { ok: false, message: 'Trip not found.' };
    await closeSos(db, job, shipment, 'control room');
    revalidatePath('/admin');
    return { ok: true, message: 'SOS marked resolved. The client has been told.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not resolve the SOS.' };
  }
}
