import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthKey } from './format';
import { ROAD_FACTOR, haversineKm } from './geo';
import { driverPayout } from './pricing';
import type {
  AppNotification,
  City,
  Client,
  Driver,
  FleetGroup,
  Incident,
  JobCard,
  MembershipTier,
  ReturnLoad,
  Shipment,
  VehicleType,
  Wallet,
} from './types';

type Db = SupabaseClient;
type Result = { data: unknown; error: { message: string } | null };

/** A truck this far along its route starts getting return-trip suggestions. */
export const RETURN_LOAD_PROGRESS = 0.6;

export const LIVE_JOB_STATUSES = ['offered', 'assigned', 'in_transit'] as const;

/** An idle driver is shown open loads whose pickup is at most this far away by road. */
export const OPEN_LOAD_RADIUS_KM = 150;

/** Await a Supabase query and return its rows, throwing on a database error. */
export async function rows<T>(query: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as T[] | null) ?? [];
}

export async function one<T>(query: PromiseLike<Result>): Promise<T | null> {
  const list = await rows<T>(query);
  return list[0] ?? null;
}

export type Reference = { cities: City[]; vehicles: VehicleType[]; tiers: MembershipTier[] };

export async function getReference(db: Db): Promise<Reference> {
  const [cities, vehicles, tiers] = await Promise.all([
    rows<City>(db.from('cities').select('*').order('name')),
    rows<VehicleType>(db.from('vehicle_types').select('*').order('capacity_kg')),
    rows<MembershipTier>(db.from('membership_tiers').select('*').order('priority')),
  ]);
  return { cities, vehicles, tiers };
}

async function byIds<T>(db: Db, table: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return rows<T>(db.from(table).select('*').in('id', unique));
}

// ---------------------------------------------------------------------------
// Client portal
// ---------------------------------------------------------------------------
export type ClientDashboard = Reference & {
  client: Client;
  tier: MembershipTier;
  shipments: Shipment[];
  jobs: JobCard[];
  drivers: Driver[];
  notifications: AppNotification[];
  /** Idle trucks by city, the client's own city first. */
  fleet: FleetGroup[];
};

export async function getClientDashboard(db: Db, clientId: string): Promise<ClientDashboard | null> {
  const [client, ref, shipments, notifications] = await Promise.all([
    one<Client>(db.from('clients').select('*').eq('id', clientId)),
    getReference(db),
    rows<Shipment>(db.from('shipments').select('*').eq('client_id', clientId).order('created_at', { ascending: false })),
    rows<AppNotification>(
      db
        .from('notifications')
        .select('*')
        .eq('recipient_role', 'client')
        .eq('recipient_id', clientId)
        .order('created_at', { ascending: false })
        .limit(25),
    ),
  ]);
  if (!client) return null;
  const shipmentIds = shipments.map((s) => s.id);
  const jobs = shipmentIds.length
    ? await rows<JobCard>(
        db.from('job_cards').select('*').in('shipment_id', shipmentIds).in('status', ['offered', 'assigned', 'in_transit', 'delivered']),
      )
    : [];
  const [drivers, idle, busy] = await Promise.all([
    byIds<Driver>(db, 'drivers', jobs.map((j) => j.driver_id)),
    rows<Pick<Driver, 'id' | 'vehicle_type' | 'current_city' | 'home_city'>>(
      db.from('drivers').select('id,vehicle_type,current_city,home_city').eq('status', 'available'),
    ),
    // A driver with a trip lined up is not free, even before it starts.
    rows<{ driver_id: string }>(db.from('job_cards').select('driver_id').in('status', ['assigned', 'in_transit'])),
  ]);
  const tier = ref.tiers.find((t) => t.id === client.membership_tier) ?? ref.tiers[0];

  const taken = new Set(busy.map((b) => b.driver_id));
  const byCity = new Map<string, Map<string, number>>();
  for (const d of idle) {
    if (taken.has(d.id)) continue;
    const city = d.current_city ?? d.home_city;
    const name = ref.vehicles.find((v) => v.id === d.vehicle_type)?.name ?? 'Truck';
    const counts = byCity.get(city) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    byCity.set(city, counts);
  }
  const fleet: FleetGroup[] = [...byCity.entries()]
    .map(([city, counts]) => ({
      city,
      total: [...counts.values()].reduce((a, b) => a + b, 0),
      vehicles: [...counts.entries()].map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => Number(b.city === client.city) - Number(a.city === client.city) || b.total - a.total || a.city.localeCompare(b.city));

  return { ...ref, client, tier, shipments, jobs, drivers, notifications, fleet };
}

// ---------------------------------------------------------------------------
// Driver portal
// ---------------------------------------------------------------------------
export type DriverDashboard = Reference & {
  driver: Driver;
  vehicle: VehicleType;
  jobs: JobCard[];
  shipments: Shipment[];
  clients: Client[];
  incidents: Incident[];
  notifications: AppNotification[];
  returnLoads: ReturnLoad[];
  /** Loads an idle driver can take right now, nearest pickup first. */
  openLoads: ReturnLoad[];
  wallet: Wallet;
};

export async function getDriverDashboard(db: Db, driverId: string): Promise<DriverDashboard | null> {
  const [driver, ref, jobs, notifications] = await Promise.all([
    one<Driver>(db.from('drivers').select('*').eq('id', driverId)),
    getReference(db),
    rows<JobCard>(
      db
        .from('job_cards')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ['offered', 'assigned', 'in_transit', 'delivered'])
        .order('created_at', { ascending: false })
        .limit(25),
    ),
    rows<AppNotification>(
      db
        .from('notifications')
        .select('*')
        .eq('recipient_role', 'driver')
        .eq('recipient_id', driverId)
        .order('created_at', { ascending: false })
        .limit(25),
    ),
  ]);
  if (!driver) return null;
  const vehicle = ref.vehicles.find((v) => v.id === driver.vehicle_type) ?? ref.vehicles[0];
  const shipments = await byIds<Shipment>(db, 'shipments', jobs.map((j) => j.shipment_id));
  const active = jobs.find((j) => j.status === 'in_transit');
  const [clients, incidents] = await Promise.all([
    byIds<Client>(db, 'clients', shipments.map((s) => s.client_id)),
    active
      ? rows<Incident>(db.from('incidents').select('*').eq('job_card_id', active.id).order('created_at', { ascending: false }).limit(5))
      : Promise.resolve([]),
  ]);

  // Return-trip suggestions: open loads leaving the city this truck is about to reach.
  let returnLoads: ReturnLoad[] = [];
  const hasQueued = jobs.some((j) => j.status === 'assigned' || j.status === 'offered');
  if (active && Number(active.progress) >= RETURN_LOAD_PROGRESS && !hasQueued) {
    const activeShipment = shipments.find((s) => s.id === active.shipment_id);
    if (activeShipment) {
      const open = await rows<Shipment>(
        db
          .from('shipments')
          .select('*')
          .eq('status', 'pending')
          .eq('origin_city', activeShipment.dest_city)
          .lte('weight_kg', vehicle.capacity_kg)
          .order('priority', { ascending: false })
          .limit(12),
      );
      const openClients = await byIds<Client>(db, 'clients', open.map((s) => s.client_id));
      returnLoads = open
        .map((shipment) => ({
          shipment,
          client_name: openClients.find((c) => c.id === shipment.client_id)?.company_name ?? 'Client',
          towards_home: shipment.dest_city === driver.home_city || shipment.dest_city === activeShipment.origin_city,
          earnings_inr: driverPayout(shipment.quoted_price_inr, driver.driver_type),
        }))
        .sort((a, b) => Number(b.towards_home) - Number(a.towards_home) || b.shipment.priority - a.shipment.priority)
        .slice(0, 3);
    }
  }

  // Open loads for a driver with nothing on: pending shipments that fit the truck and start nearby.
  let openLoads: ReturnLoad[] = [];
  const committed = jobs.some((j) => j.status === 'assigned' || j.status === 'in_transit');
  const basedAt = ref.cities.find((c) => c.name === (driver.current_city ?? driver.home_city));
  const position = driver.current_lat != null && driver.current_lng != null ? { lat: driver.current_lat, lng: driver.current_lng } : basedAt;
  if (!committed && driver.status !== 'offline' && position) {
    const [open, declined] = await Promise.all([
      rows<Shipment>(
        db.from('shipments').select('*').eq('status', 'pending').lte('weight_kg', vehicle.capacity_kg).order('priority', { ascending: false }).limit(60),
      ),
      rows<{ shipment_id: string }>(db.from('job_cards').select('shipment_id').eq('driver_id', driverId).eq('status', 'rejected').limit(200)),
    ]);
    const skip = new Set(declined.map((d) => d.shipment_id));
    const near = open.flatMap((shipment) => {
      const origin = ref.cities.find((c) => c.name === shipment.origin_city);
      if (!origin || skip.has(shipment.id)) return [];
      const pickup_km = Math.round(haversineKm(position, origin) * ROAD_FACTOR);
      return pickup_km <= OPEN_LOAD_RADIUS_KM ? [{ shipment, pickup_km: pickup_km < 25 ? 0 : pickup_km }] : [];
    });
    const openClients = await byIds<Client>(db, 'clients', near.map((n) => n.shipment.client_id));
    openLoads = near
      .map(({ shipment, pickup_km }) => ({
        shipment,
        pickup_km,
        client_name: openClients.find((c) => c.id === shipment.client_id)?.company_name ?? 'Client',
        towards_home: shipment.dest_city === driver.home_city && shipment.origin_city !== driver.home_city,
        earnings_inr: driverPayout(shipment.quoted_price_inr, driver.driver_type),
      }))
      .sort((a, b) => a.pickup_km - b.pickup_km || Number(b.towards_home) - Number(a.towards_home) || b.shipment.priority - a.shipment.priority)
      .slice(0, 6);
  }

  // Earnings statement: every delivered trip is one credit.
  const paid = await rows<Pick<JobCard, 'id' | 'shipment_id' | 'delivered_at'>>(
    db.from('job_cards').select('id,shipment_id,delivered_at').eq('driver_id', driverId).eq('status', 'delivered').order('delivered_at', { ascending: false }).limit(200),
  );
  const known = new Map(shipments.map((s) => [s.id, s]));
  const missing = paid.map((p) => p.shipment_id).filter((id) => !known.has(id));
  for (const s of await byIds<Shipment>(db, 'shipments', missing)) known.set(s.id, s);
  const thisMonth = monthKey(new Date());
  const entries = paid.flatMap((p) => {
    const s = known.get(p.shipment_id);
    if (!s || !p.delivered_at) return [];
    return [
      {
        id: p.id,
        delivered_at: p.delivered_at,
        reference: s.reference,
        route: `${s.origin_city} to ${s.dest_city}`,
        weight_kg: s.weight_kg,
        amount_inr: driverPayout(s.quoted_price_inr, driver.driver_type),
      },
    ];
  });
  const all_time_inr = entries.reduce((sum, e) => sum + e.amount_inr, 0);
  const wallet: Wallet = {
    balance_inr: all_time_inr,
    all_time_inr,
    month_inr: entries.filter((e) => monthKey(e.delivered_at) === thisMonth).reduce((sum, e) => sum + e.amount_inr, 0),
    entries,
  };

  return { ...ref, driver, vehicle, jobs, shipments, clients, incidents, notifications, returnLoads, openLoads, wallet };
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------
export type AdminOverview = Reference & {
  clients: Client[];
  drivers: Driver[];
  shipments: Shipment[];
  jobs: JobCard[];
  incidents: Incident[];
  notifications: AppNotification[];
};

export async function getAdminOverview(db: Db): Promise<AdminOverview> {
  const [ref, clients, drivers, shipments, jobs, incidents, notifications] = await Promise.all([
    getReference(db),
    rows<Client>(db.from('clients').select('*').order('company_name')),
    rows<Driver>(db.from('drivers').select('*').order('name')),
    rows<Shipment>(db.from('shipments').select('*').order('created_at', { ascending: false }).limit(100)),
    rows<JobCard>(
      db.from('job_cards').select('*').in('status', ['offered', 'assigned', 'in_transit', 'delivered']).order('created_at', { ascending: false }).limit(100),
    ),
    rows<Incident>(db.from('incidents').select('*').order('created_at', { ascending: false }).limit(15)),
    rows<AppNotification>(db.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)),
  ]);
  return { ...ref, clients, drivers, shipments, jobs, incidents, notifications };
}
