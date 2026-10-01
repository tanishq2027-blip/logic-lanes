import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { one, rows } from './data';
import { REAL_TIME, notify, type NewNotification } from './dispatch';
import { effectivePath, nearestCity, pointAtProgress } from './geo';
import type { City, Driver, JobCard, Shipment } from './types';

type Db = SupabaseClient;

/** True when the database error means supabase/upgrade.sql has not been run yet. */
const columnsMissing = (message: string) => /sos_at|sos_resolved_at/.test(message) && /column|schema cache/i.test(message);

async function adminRecipient(db: Db): Promise<string | null> {
  const admin = await one<{ id: string }>(db.from('admins').select('id').limit(1));
  return admin?.id ?? null;
}

/**
 * The driver has confirmed an emergency.
 *
 * What this does: flags the Job Card, stops the truck's clock, and alerts the
 * client and the control room inside the app. What it does NOT do: contact
 * the police, an ambulance or the highway helpline. The driver is told to call
 * 112 / 1033 themselves, and the wording everywhere says so.
 *
 * The alerts are sent even if the flag cannot be stored (upgrade.sql not run yet):
 * in an emergency, telling people matters more than bookkeeping.
 */
export async function raiseSos(db: Db, job: JobCard, driver: Driver, shipment: Shipment): Promise<{ recorded: boolean }> {
  const now = new Date().toISOString();
  let recorded = true;
  const flagged = await db
    .from('job_cards')
    // sim_multiplier 0: a truck in an emergency is stopped.
    .update({ sos_at: now, sos_resolved_at: null, sim_multiplier: 0, speed_kmph: 0, last_telemetry_at: now })
    .eq('id', job.id)
    .select('id');
  if (flagged.error) {
    if (!columnsMissing(flagged.error.message)) throw new Error(flagged.error.message);
    recorded = false;
    await rows(db.from('job_cards').update({ sim_multiplier: 0, speed_kmph: 0, last_telemetry_at: now }).eq('id', job.id).select('id'));
  }

  const cities = await rows<City>(db.from('cities').select('*'));
  const here = pointAtProgress(effectivePath(job), Number(job.progress));
  const near = nearestCity(here, cities)?.city.name ?? shipment.origin_city;
  const where = `near ${near} (${here.lat.toFixed(4)}, ${here.lng.toFixed(4)})`;

  const items: NewNotification[] = [
    {
      recipient_role: 'client',
      recipient_id: shipment.client_id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'incident',
      title: `${shipment.reference}: driver has raised an SOS`,
      body: `${driver.name} (${driver.vehicle_number}, ${driver.phone}) reported an emergency ${where}. The truck is stopped and our control room has been alerted.`,
    },
  ];
  const admin = await adminRecipient(db);
  if (admin) {
    items.push({
      recipient_role: 'admin',
      recipient_id: admin,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'incident',
      title: `SOS: ${driver.name} on ${shipment.reference}`,
      body: `Emergency reported ${where}. Driver phone ${driver.phone}, vehicle ${driver.vehicle_number}. Call the driver; if needed call 112 on their behalf.`,
    });
  }
  await notify(db, items);
  return { recorded };
}

/** The emergency is over: clear the flag, let the truck move again, tell the client. */
export async function closeSos(db: Db, job: JobCard, shipment: Shipment, by: 'driver' | 'control room'): Promise<void> {
  const now = new Date().toISOString();
  const cleared = await db
    .from('job_cards')
    .update({ sos_resolved_at: now, sim_multiplier: REAL_TIME, last_telemetry_at: now })
    .eq('id', job.id)
    .select('id');
  if (cleared.error) {
    if (!columnsMissing(cleared.error.message)) throw new Error(cleared.error.message);
    await rows(db.from('job_cards').update({ sim_multiplier: REAL_TIME, last_telemetry_at: now }).eq('id', job.id).select('id'));
  }

  const items: NewNotification[] = [
    {
      recipient_role: 'client',
      recipient_id: shipment.client_id,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'info',
      title: `${shipment.reference}: SOS cleared`,
      body: `The emergency was marked resolved by the ${by}. The truck is back on its way.`,
    },
  ];
  const admin = await adminRecipient(db);
  if (admin && by === 'driver') {
    items.push({
      recipient_role: 'admin',
      recipient_id: admin,
      shipment_id: shipment.id,
      job_card_id: job.id,
      kind: 'info',
      title: `SOS cleared on ${shipment.reference}`,
      body: 'The driver marked themselves safe.',
    });
  }
  await notify(db, items);
}
