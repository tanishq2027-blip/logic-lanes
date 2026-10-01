'use server';

import { revalidatePath } from 'next/cache';
import { getReference, one, rows } from '@/lib/data';
import { dispatchShipment, notify } from '@/lib/dispatch';
import { inr } from '@/lib/format';
import { ROAD_FACTOR, haversineKm } from '@/lib/geo';
import { pickVehicle, quote } from '@/lib/pricing';
import { getSession } from '@/lib/session';
import { DASHBOARD } from '@/lib/supabase/cookies';
import { getDb } from '@/lib/supabase/server';
import type { Client, GoodsCategory, Shipment } from '@/lib/types';

const CATEGORIES: GoodsCategory[] = ['general', 'fragile', 'perishable', 'hazardous', 'machinery', 'electronics'];

export type BookingState = {
  ok: boolean;
  message: string;
  /** Present when a driver was matched: the browser then asks the Edge AI route for a briefing. */
  jobCardId?: string;
  result?: {
    reference: string;
    price_inr: number;
    discount_pct: number;
    vehicle: string;
    driver: string | null;
    driver_type: 'gig' | 'full_time' | null;
    backhaul: boolean;
    reason: string;
  };
};

/** Server Action behind the cargo booking form: validate, price, save and auto-dispatch. */
export async function bookShipment(_prev: BookingState, formData: FormData): Promise<BookingState> {
  try {
    const session = await getSession('client');
    if (!session) return { ok: false, message: 'Please sign in as a client again.' };

    const goods = String(formData.get('goods') ?? '').trim();
    const category = String(formData.get('category') ?? 'general') as GoodsCategory;
    const weight = Math.round(Number(formData.get('weight')));
    const originName = String(formData.get('origin') ?? '');
    const destName = String(formData.get('dest') ?? '');
    const pickup = String(formData.get('pickup') ?? '');
    const delivery = String(formData.get('delivery') ?? '');
    const today = new Date().toISOString().slice(0, 10);

    if (goods.length < 3 || goods.length > 300) return { ok: false, message: 'Describe the goods in 3 to 300 characters.' };
    if (!CATEGORIES.includes(category)) return { ok: false, message: 'Choose a goods type.' };
    if (!Number.isFinite(weight) || weight < 1) return { ok: false, message: 'Enter the weight in kilograms.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup) || !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) {
      return { ok: false, message: 'Choose a pickup date and a delivery date.' };
    }
    if (pickup < today) return { ok: false, message: 'The pickup date cannot be in the past.' };
    if (delivery < pickup) return { ok: false, message: 'The delivery date must be on or after the pickup date.' };
    if (originName === destName) return { ok: false, message: 'Pickup and drop-off cities must be different.' };

    const db = getDb();
    const [ref, client] = await Promise.all([
      getReference(db),
      one<Client>(db.from('clients').select('*').eq('id', session.id)),
    ]);
    if (!client) return { ok: false, message: 'Client account not found.' };
    const origin = ref.cities.find((c) => c.name === originName);
    const dest = ref.cities.find((c) => c.name === destName);
    if (!origin || !dest) return { ok: false, message: 'Choose pickup and drop-off cities from the list.' };

    const vehicle = pickVehicle(weight, ref.vehicles);
    if (!vehicle) {
      const max = Math.max(...ref.vehicles.map((v) => v.capacity_kg));
      return { ok: false, message: `One truck carries at most ${max.toLocaleString('en-IN')} kg. Please split the load.` };
    }
    const tier = ref.tiers.find((t) => t.id === client.membership_tier) ?? ref.tiers[0];
    const distanceKm = Math.round(haversineKm(origin, dest) * ROAD_FACTOR);
    const first = quote({ distanceKm, weightKg: weight, vehicle, vehicles: ref.vehicles, tier, backhaul: false });

    const shipment = await one<Shipment>(
      db
        .from('shipments')
        .insert({
          client_id: client.id,
          goods_description: goods,
          goods_category: category,
          weight_kg: weight,
          origin_city: origin.name,
          dest_city: dest.name,
          pickup_date: pickup,
          delivery_date: delivery,
          vehicle_type: vehicle.id,
          status: 'pending',
          priority: tier.priority,
          distance_km: distanceKm,
          quoted_price_inr: first.price_inr,
          discount_pct: first.discount_pct,
        })
        .select('*'),
    );
    if (!shipment) return { ok: false, message: 'Could not save the booking. Please try again.' };

    const { job, match } = await dispatchShipment(db, shipment);
    const saved = (await one<Shipment>(db.from('shipments').select('*').eq('id', shipment.id))) ?? shipment;
    revalidatePath(DASHBOARD.client);

    return {
      ok: true,
      jobCardId: job?.id,
      message: match
        ? match.driver.driver_type === 'full_time'
          ? `Booked. ${match.driver.name} is assigned to ${saved.reference}.`
          : `Booked. ${saved.reference} is offered to ${match.driver.name}; you will be notified when it is accepted.`
        : `Booked as ${saved.reference}. No truck is free near ${origin.name} yet, so the load is advertised to trucks arriving there.`,
      result: {
        reference: saved.reference,
        price_inr: saved.quoted_price_inr,
        discount_pct: Number(saved.discount_pct),
        vehicle: vehicle.name,
        driver: match?.driver.name ?? null,
        driver_type: match?.driver.driver_type ?? null,
        backhaul: match?.backhaul ?? false,
        reason: match?.reason ?? '',
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Booking failed. Please try again.' };
  }
}

export type SimpleState = { ok: boolean; message: string };

export async function changeTier(tierId: string): Promise<SimpleState> {
  try {
    const session = await getSession('client');
    if (!session) return { ok: false, message: 'Please sign in as a client again.' };
    const db = getDb();
    const ref = await getReference(db);
    const tier = ref.tiers.find((t) => t.id === tierId);
    if (!tier) return { ok: false, message: 'Unknown membership plan.' };
    await rows(
      db
        .from('clients')
        .update({ membership_tier: tier.id, membership_since: new Date().toISOString().slice(0, 10) })
        .eq('id', session.id)
        .select('id'),
    );
    await notify(db, [
      {
        recipient_role: 'client',
        recipient_id: session.id,
        kind: 'info',
        title: `You are now on ${tier.name}`,
        body:
          Number(tier.freight_discount_pct) > 0
            ? `${Number(tier.freight_discount_pct)}% lower freight applies to every new booking.`
            : 'Standard rates apply to new bookings.',
      },
    ]);
    revalidatePath(DASHBOARD.client);
    return { ok: true, message: `Membership changed to ${tier.name}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not change the plan.' };
  }
}

export async function markNotificationsRead(role: 'client' | 'driver'): Promise<void> {
  if (role !== 'client' && role !== 'driver') return;
  const session = await getSession(role);
  if (!session) return;
  const db = getDb();
  await db.from('notifications').update({ read: true }).eq('recipient_role', session.role).eq('recipient_id', session.id).eq('read', false);
  revalidatePath(DASHBOARD[role]);
}

/**
 * The client says they have paid the freight for a delivered shipment.
 * This is the client's own declaration: the app has no link to a bank or UPI
 * provider, so the control room is told and reconciles it against the account.
 */
export async function markShipmentPaid(shipmentId: string): Promise<SimpleState> {
  try {
    const session = await getSession('client');
    if (!session) return { ok: false, message: 'Please sign in as a client again.' };
    const db = getDb();
    const shipment = await one<Shipment>(db.from('shipments').select('*').eq('id', shipmentId).eq('client_id', session.id));
    if (!shipment) return { ok: false, message: 'Shipment not found.' };
    if (shipment.status !== 'delivered') return { ok: false, message: 'Payment unlocks after the job is delivered.' };
    if (shipment.paid_at) return { ok: true, message: 'This shipment is already marked as paid.' };

    const { error } = await db.from('shipments').update({ paid_at: new Date().toISOString() }).eq('id', shipment.id).select('id');
    if (error) {
      if (/paid_at/.test(error.message)) {
        return { ok: false, message: 'Payments are not set up in the database yet. Run supabase/upgrade.sql in the Supabase SQL Editor.' };
      }
      throw new Error(error.message);
    }

    const admin = await one<{ id: string }>(db.from('admins').select('id').limit(1));
    if (admin) {
      await notify(db, [
        {
          recipient_role: 'admin',
          recipient_id: admin.id,
          shipment_id: shipment.id,
          kind: 'info',
          title: `${shipment.reference}: client marked freight as paid`,
          body: `${session.name} reports paying ${inr(shipment.quoted_price_inr)} by UPI. Check the account to confirm.`,
        },
      ]);
    }
    revalidatePath(DASHBOARD.client);
    return { ok: true, message: `${shipment.reference} marked as paid. Thank you.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not record the payment.' };
  }
}
