export type Role = 'client' | 'driver' | 'admin';

export type LatLng = { lat: number; lng: number };

export type City = { name: string; state: string; lat: number; lng: number };

export type MembershipTier = {
  id: string;
  name: string;
  monthly_price_inr: number;
  freight_discount_pct: number;
  priority: number;
  update_interval_sec: number;
  realtime_updates: boolean;
  ai_tracking: boolean;
  perks: string[];
};

export type VehicleType = {
  id: string;
  name: string;
  capacity_kg: number;
  /** Bottom of the per-km rate band. */
  rate_per_km_inr: number;
  /** Top of the band. Absent until supabase/upgrade.sql has been run. */
  rate_max_per_km_inr?: number | null;
  suitable_cargo?: string | null;
  avg_speed_kmph: number;
  avoid_narrow_roads: boolean;
  routing_note: string;
};

export type Client = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  city: string;
  client_type: 'individual' | 'company';
  membership_tier: string;
  membership_since: string;
};

export type DriverType = 'gig' | 'full_time';
export type DriverStatus = 'available' | 'on_trip' | 'offline';

export type Driver = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  driver_type: DriverType;
  status: DriverStatus;
  vehicle_type: string;
  vehicle_number: string;
  home_city: string;
  current_city: string | null;
  current_lat: number | null;
  current_lng: number | null;
  rating: number;
  trips_completed: number;
  monthly_salary_inr: number | null;
};

export type GoodsCategory = 'general' | 'fragile' | 'perishable' | 'hazardous' | 'machinery' | 'electronics';
export type ShipmentStatus = 'pending' | 'offered' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';

export type Shipment = {
  id: string;
  reference: string;
  client_id: string;
  goods_description: string;
  goods_category: GoodsCategory;
  weight_kg: number;
  origin_city: string;
  dest_city: string;
  pickup_date: string;
  delivery_date: string;
  vehicle_type: string;
  status: ShipmentStatus;
  priority: number;
  distance_km: number;
  quoted_price_inr: number;
  discount_pct: number;
  is_backhaul: boolean;
  created_at: string;
  /** When the client marked the freight as paid (self-declared). Absent until supabase/upgrade.sql has been run. */
  paid_at?: string | null;
};

export type WaypointKind = 'origin' | 'via' | 'detour' | 'destination';

/** `at` is the fraction of the route (0..1) at which the truck reaches this point. */
export type Waypoint = LatLng & { name: string; kind: WaypointKind; at: number };

export type RouteStep = { instruction: string; distance_km: number; at: number };

/** Dense polyline stored as [lat, lng] pairs. */
export type PathPoint = [number, number];

export type JobStatus = 'offered' | 'assigned' | 'in_transit' | 'delivered' | 'rejected' | 'cancelled';

export type JobCard = {
  id: string;
  shipment_id: string;
  driver_id: string;
  status: JobStatus;
  goods_summary: string;
  ai_summary: string | null;
  ai_provider: string;
  waypoints: Waypoint[];
  route_path: PathPoint[];
  steps: RouteStep[];
  /** 'estimate' = city-to-city guess; 'google' = real road route (legacy name, see ROAD_SOURCE in lib/roadRoute.ts). */
  route_source: 'estimate' | 'google';
  route_version: number;
  distance_km: number;
  duration_min: number;
  progress: number;
  current_lat: number | null;
  current_lng: number | null;
  speed_kmph: number;
  eta: string | null;
  sim_multiplier: number;
  last_telemetry_at: string;
  is_backhaul: boolean;
  match_score: number;
  match_reason: string;
  offered_at: string;
  accepted_at: string | null;
  started_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  /** SOS raised by the driver. Open while `sos_at` is set and `sos_resolved_at` is not. Absent until supabase/upgrade.sql has been run. */
  sos_at?: string | null;
  sos_resolved_at?: string | null;
};

export const sosOpen = (job: Pick<JobCard, 'sos_at' | 'sos_resolved_at'>): boolean => Boolean(job.sos_at) && !job.sos_resolved_at;

export type IncidentType = 'accident' | 'traffic' | 'weather' | 'road_closure';

export type Incident = {
  id: string;
  job_card_id: string;
  type: IncidentType;
  severity: number;
  description: string;
  lat: number;
  lng: number;
  source: 'admin' | 'google_traffic';
  delay_min: number;
  created_at: string;
};

export type NotificationKind =
  | 'info'
  | 'offer'
  | 'assignment'
  | 'milestone'
  | 'delay'
  | 'reroute'
  | 'incident'
  | 'backhaul'
  | 'delivered';

export type AppNotification = {
  id: string;
  recipient_role: Role;
  recipient_id: string;
  shipment_id: string | null;
  job_card_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type Weather = {
  place: string;
  temp_c: number | null;
  condition: string;
  wind_kmph: number | null;
  rain_mm: number | null;
  severe: boolean;
  source: 'weatherapi' | 'openweather' | 'open-meteo' | 'unavailable';
};

/** A pending shipment the driver could carry on the way back. */
export type ReturnLoad = {
  shipment: Shipment;
  client_name: string;
  towards_home: boolean;
  earnings_inr: number;
  /** Empty run from the driver to the pickup city, for loads offered to an idle driver. */
  pickup_km?: number;
};

/** One credit in a driver's earnings statement: a delivered trip. */
export type WalletEntry = {
  id: string;
  delivered_at: string;
  reference: string;
  route: string;
  weight_kg: number;
  amount_inr: number;
};

/** Derived from delivered trips. Nothing is paid out by the app, so the balance is everything earned so far. */
export type Wallet = {
  balance_inr: number;
  month_inr: number;
  all_time_inr: number;
  entries: WalletEntry[];
};

/** Idle trucks in one city, for the client's "Trucks available" panel. Counts only; no driver details. */
export type FleetGroup = {
  city: string;
  total: number;
  vehicles: { name: string; count: number }[];
};
