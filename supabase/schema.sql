-- =============================================================================
-- Logic Lanes — Supabase schema, RLS policies and seed data
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Then run supabase/auth.sql, which adds Supabase Auth sign-in (profiles table
-- and the sign-up trigger). Run auth.sql again every time you re-run this file.
--
-- WARNING: the script is re-runnable. It DROPS and recreates every Logic Lanes
-- table listed below, so run it only in a project dedicated to this app.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Clean slate
-- ---------------------------------------------------------------------------
drop table if exists public.live_events      cascade;
drop table if exists public.notifications    cascade;
drop table if exists public.incidents        cascade;
drop table if exists public.job_cards        cascade;
drop table if exists public.shipments        cascade;
drop table if exists public.drivers          cascade;
drop table if exists public.clients          cascade;
drop table if exists public.admins           cascade;
drop table if exists public.vehicle_types    cascade;
drop table if exists public.membership_tiers cascade;
drop table if exists public.cities           cascade;
drop sequence if exists public.shipment_ref_seq;

drop type if exists public.driver_type;
drop type if exists public.driver_status;
drop type if exists public.shipment_status;
drop type if exists public.job_status;
drop type if exists public.incident_type;
drop type if exists public.notification_kind;
drop type if exists public.recipient_role;

-- ---------------------------------------------------------------------------
-- 1. Enumerations
-- ---------------------------------------------------------------------------
create type public.driver_type       as enum ('gig', 'full_time');
create type public.driver_status     as enum ('available', 'on_trip', 'offline');
create type public.shipment_status   as enum ('pending', 'offered', 'assigned', 'in_transit', 'delivered', 'cancelled');
create type public.job_status        as enum ('offered', 'assigned', 'in_transit', 'delivered', 'rejected', 'cancelled');
create type public.incident_type     as enum ('accident', 'traffic', 'weather', 'road_closure');
create type public.notification_kind as enum ('info', 'offer', 'assignment', 'milestone', 'delay', 'reroute', 'incident', 'backhaul', 'delivered');
create type public.recipient_role    as enum ('client', 'driver', 'admin');

-- ---------------------------------------------------------------------------
-- 2. Reference tables
-- ---------------------------------------------------------------------------
create table public.cities (
  name  text primary key,
  state text not null,
  lat   double precision not null,
  lng   double precision not null
);

create table public.membership_tiers (
  id                   text primary key,
  name                 text not null,
  monthly_price_inr    integer not null default 0,
  freight_discount_pct numeric(5,2) not null default 0,
  priority             integer not null default 0,        -- higher = matched first
  update_interval_sec  integer not null default 30,       -- dashboard refresh cadence
  realtime_updates     boolean not null default false,    -- instant push via Supabase Realtime
  ai_tracking          boolean not null default false,    -- AI briefing + live route map
  perks                text[] not null default '{}'
);

create table public.vehicle_types (
  id                 text primary key,
  name               text not null,
  capacity_kg        integer not null,
  rate_per_km_inr    numeric(8,2) not null,                -- bottom of the per-km rate band
  rate_max_per_km_inr numeric(8,2),                        -- top of the band (a full load pays this)
  suitable_cargo     text not null default '',
  avg_speed_kmph     integer not null,
  avoid_narrow_roads boolean not null default false,      -- routing: keep to trunk highways
  routing_note       text not null default ''
);

-- ---------------------------------------------------------------------------
-- 3. Role tables (Clients, Drivers, Admins)
--    auth_user_id links a row to its Supabase Auth user. The sign-up trigger in
--    auth.sql sets it for new accounts; scripts/seed-demo-users.mjs sets it for
--    the seeded demo personas below.
-- ---------------------------------------------------------------------------
create table public.admins (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name         text not null,
  email        text not null unique,
  created_at   timestamptz not null default now()
);

create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique references auth.users (id) on delete set null,
  company_name     text not null,
  contact_name     text not null,
  email            text not null unique,
  phone            text not null,
  city             text not null references public.cities (name),
  membership_tier  text not null default 'standard' references public.membership_tiers (id),
  membership_since date not null default current_date,
  created_at       timestamptz not null default now()
);

create table public.drivers (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users (id) on delete set null,
  name               text not null,
  phone              text not null,
  driver_type        public.driver_type not null,          -- gig = accept/reject, full_time = auto-assigned
  status             public.driver_status not null default 'available',
  vehicle_type       text not null references public.vehicle_types (id),
  vehicle_number     text not null unique,
  home_city          text not null references public.cities (name),
  current_city       text references public.cities (name),
  current_lat        double precision,
  current_lng        double precision,
  rating             numeric(2,1) not null default 4.5,
  trips_completed    integer not null default 0,
  monthly_salary_inr integer,                              -- full-time only
  created_at         timestamptz not null default now(),
  constraint salary_only_for_full_time
    check (driver_type = 'full_time' or monthly_salary_inr is null)
);

-- ---------------------------------------------------------------------------
-- 4. Logistics tables
-- ---------------------------------------------------------------------------
create sequence public.shipment_ref_seq start 1001;

create table public.shipments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default ('FP-' || nextval('public.shipment_ref_seq')),
  client_id         uuid not null references public.clients (id) on delete cascade,
  goods_description text not null,
  goods_category    text not null default 'general'
    check (goods_category in ('general', 'fragile', 'perishable', 'hazardous', 'machinery', 'electronics')),
  weight_kg         integer not null check (weight_kg > 0),
  origin_city       text not null references public.cities (name),
  dest_city         text not null references public.cities (name),
  pickup_date       date not null,
  delivery_date     date not null,
  vehicle_type      text not null references public.vehicle_types (id),
  status            public.shipment_status not null default 'pending',
  priority          integer not null default 0,             -- copied from the client's tier at booking
  distance_km       numeric(8,1) not null default 0,
  quoted_price_inr  integer not null default 0,
  discount_pct      numeric(5,2) not null default 0,
  is_backhaul       boolean not null default false,         -- carried on a return trip (no deadhead)
  paid_at           timestamptz,                            -- when the client marked the freight as paid (self-declared)
  created_at        timestamptz not null default now(),
  constraint different_cities check (origin_city <> dest_city),
  constraint delivery_after_pickup check (delivery_date >= pickup_date)
);

create table public.job_cards (
  id                uuid primary key default gen_random_uuid(),
  shipment_id       uuid not null references public.shipments (id) on delete cascade,
  driver_id         uuid not null references public.drivers (id) on delete cascade,
  status            public.job_status not null default 'offered',
  goods_summary     text not null,                           -- exact goods description for the driver
  ai_summary        text,                                    -- AI transport briefing
  ai_provider       text not null default 'deterministic',   -- gemini | groq | deterministic
  -- Route geometry
  waypoints         jsonb not null default '[]'::jsonb,      -- [{name, lat, lng, kind, at}]
  route_path        jsonb not null default '[]'::jsonb,      -- [[lat, lng], ...] dense polyline
  steps             jsonb not null default '[]'::jsonb,      -- [{instruction, distance_km, at}] next turns
  -- 'estimate' = city-to-city guess; 'google' = real road geometry from the routing
  -- provider (the name is historical: the provider is now OpenRouteService).
  route_source      text not null default 'estimate' check (route_source in ('estimate', 'google')),
  route_version     integer not null default 1,              -- bumped on every reroute
  distance_km       numeric(8,1) not null default 0,
  duration_min      integer not null default 0,
  -- Live telemetry
  progress          numeric(6,5) not null default 0 check (progress >= 0 and progress <= 1),
  current_lat       double precision,
  current_lng       double precision,
  speed_kmph        integer not null default 0,
  eta               timestamptz,
  sim_multiplier    integer not null default 1,              -- demo clock: 1 = real time, 60 = 1 real sec is 1 trip minute
  last_telemetry_at timestamptz not null default now(),
  -- Matching
  is_backhaul       boolean not null default false,
  match_score       integer not null default 0,
  match_reason      text not null default '',
  -- Emergency: set when the driver triggers an SOS; open until sos_resolved_at is set
  sos_at            timestamptz,
  sos_resolved_at   timestamptz,
  -- Lifecycle
  offered_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  started_at        timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A shipment can have many historical (rejected) cards but only one live one.
create unique index job_cards_one_live_per_shipment
  on public.job_cards (shipment_id)
  where status in ('offered', 'assigned', 'in_transit', 'delivered');

create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards (id) on delete cascade,
  type        public.incident_type not null,
  severity    integer not null default 2 check (severity between 1 and 3),
  description text not null,
  lat         double precision not null,
  lng         double precision not null,
  source      text not null default 'admin' check (source in ('admin', 'google_traffic')),
  delay_min   integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_role public.recipient_role not null,
  recipient_id   uuid not null,
  shipment_id    uuid references public.shipments (id) on delete cascade,
  job_card_id    uuid references public.job_cards (id) on delete cascade,
  kind           public.notification_kind not null default 'info',
  title          text not null,
  body           text not null,
  read           boolean not null default false,
  created_at     timestamptz not null default now()
);

-- "Something changed" pings. Browsers subscribe to this table over Supabase
-- Realtime and then re-fetch their data through the server, so no business
-- data ever has to be readable with the public anon key.
create table public.live_events (
  id         bigint generated always as identity primary key,
  topic      text not null,            -- a client id, a driver id, or 'admin'
  source     text not null,
  created_at timestamptz not null default now()
);

create index shipments_client_idx       on public.shipments (client_id, created_at desc);
create index shipments_status_idx       on public.shipments (status, origin_city);
create index job_cards_driver_idx       on public.job_cards (driver_id, status);
create index job_cards_status_idx       on public.job_cards (status);
create index incidents_job_idx          on public.incidents (job_card_id, created_at desc);
create index notifications_recipient_idx on public.notifications (recipient_role, recipient_id, created_at desc);
create index live_events_topic_idx      on public.live_events (topic, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Helper functions and triggers
-- ---------------------------------------------------------------------------
create or replace function public.current_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where auth_user_id = auth.uid()
$$;

create or replace function public.current_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.drivers where auth_user_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where auth_user_id = auth.uid())
$$;

-- security definer so policies on shipments and job_cards can reference each
-- other without recursive RLS evaluation.
create or replace function public.client_owns_shipment(p_shipment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shipments s
    where s.id = p_shipment and s.client_id = public.current_client_id()
  )
$$;

create or replace function public.driver_on_shipment(p_shipment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.job_cards j
    where j.shipment_id = p_shipment and j.driver_id = public.current_driver_id()
  )
$$;

create or replace function public.client_sees_driver(p_driver uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.job_cards j
    join public.shipments s on s.id = j.shipment_id
    where j.driver_id = p_driver
      and s.client_id = public.current_client_id()
      and j.status in ('assigned', 'in_transit', 'delivered')
  )
$$;

create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger job_cards_touch
  before update on public.job_cards
  for each row execute function public.tg_touch_updated_at();

create or replace function public.tg_job_cards_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  select client_id into v_client from public.shipments where id = new.shipment_id;
  insert into public.live_events (topic, source) values
    (new.driver_id::text, 'job_cards'),
    (v_client::text, 'job_cards'),
    ('admin', 'job_cards');
  delete from public.live_events where created_at < now() - interval '15 minutes';
  return new;
end $$;

create trigger job_cards_live
  after insert or update on public.job_cards
  for each row execute function public.tg_job_cards_live();

create or replace function public.tg_shipments_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.live_events (topic, source) values
    (new.client_id::text, 'shipments'),
    ('admin', 'shipments');
  return new;
end $$;

create trigger shipments_live
  after insert or update on public.shipments
  for each row execute function public.tg_shipments_live();

create or replace function public.tg_notifications_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.live_events (topic, source) values
    (case when new.recipient_role = 'admin' then 'admin' else new.recipient_id::text end, 'notifications');
  return new;
end $$;

create trigger notifications_live
  after insert on public.notifications
  for each row execute function public.tg_notifications_live();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--    The Next.js server uses the service-role key (which bypasses RLS) after
--    checking who is signed in, and it is the only writer. These policies
--    govern every other path: the public anon key, and signed-in users calling
--    the Data API directly with their own token. Users may read their own rows
--    but not write them, so prices, plans and telemetry cannot be self-edited.
-- ---------------------------------------------------------------------------
alter table public.cities           enable row level security;
alter table public.membership_tiers enable row level security;
alter table public.vehicle_types    enable row level security;
alter table public.admins           enable row level security;
alter table public.clients          enable row level security;
alter table public.drivers          enable row level security;
alter table public.shipments        enable row level security;
alter table public.job_cards        enable row level security;
alter table public.incidents        enable row level security;
alter table public.notifications    enable row level security;
alter table public.live_events      enable row level security;

-- Reference data: readable by everyone, writable by admins.
create policy "cities are public"          on public.cities           for select using (true);
create policy "tiers are public"           on public.membership_tiers for select using (true);
create policy "vehicle types are public"   on public.vehicle_types    for select using (true);
create policy "admins manage cities"       on public.cities           for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage tiers"        on public.membership_tiers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage vehicle types" on public.vehicle_types   for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins
create policy "admins read admins" on public.admins
  for select to authenticated using (public.is_admin());

-- Clients
create policy "clients read own profile" on public.clients
  for select to authenticated using (auth_user_id = auth.uid() or public.is_admin());
create policy "admins manage clients" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Drivers
create policy "drivers read own profile" on public.drivers
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin() or public.client_sees_driver(id));
create policy "admins manage drivers" on public.drivers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Shipments
create policy "clients read own shipments" on public.shipments
  for select to authenticated using (client_id = public.current_client_id());
create policy "drivers read their shipments and open loads" on public.shipments
  for select to authenticated
  using (public.driver_on_shipment(id) or (status = 'pending' and public.current_driver_id() is not null));
create policy "admins manage shipments" on public.shipments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Job cards
create policy "drivers read own job cards" on public.job_cards
  for select to authenticated using (driver_id = public.current_driver_id());
create policy "clients read job cards of own shipments" on public.job_cards
  for select to authenticated using (public.client_owns_shipment(shipment_id));
create policy "admins manage job cards" on public.job_cards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Incidents
create policy "parties read incidents" on public.incidents
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.job_cards j
      where j.id = job_card_id
        and (j.driver_id = public.current_driver_id() or public.client_owns_shipment(j.shipment_id))
    )
  );
create policy "admins manage incidents" on public.incidents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Notifications
create policy "recipients read notifications" on public.notifications
  for select to authenticated
  using (
    (recipient_role = 'client' and recipient_id = public.current_client_id())
    or (recipient_role = 'driver' and recipient_id = public.current_driver_id())
    or public.is_admin()
  );
create policy "recipients mark notifications read" on public.notifications
  for update to authenticated
  using (
    (recipient_role = 'client' and recipient_id = public.current_client_id())
    or (recipient_role = 'driver' and recipient_id = public.current_driver_id())
  )
  with check (
    (recipient_role = 'client' and recipient_id = public.current_client_id())
    or (recipient_role = 'driver' and recipient_id = public.current_driver_id())
  );
create policy "admins manage notifications" on public.notifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Live pings carry no business data, so anyone may listen.
create policy "anyone can listen for pings" on public.live_events for select using (true);

-- Explicit grants (RLS above still decides which rows are visible).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select on public.cities, public.membership_tiers, public.vehicle_types, public.live_events to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Supabase Realtime: stream inserts on the ping table.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.live_events;
  end if;
end $$;

-- =============================================================================
-- 7. SEED DATA
-- =============================================================================
insert into public.cities (name, state, lat, lng) values
  ('Mumbai',      'Maharashtra',    19.0760, 72.8777),
  ('Pune',        'Maharashtra',    18.5204, 73.8567),
  ('Satara',      'Maharashtra',    17.6805, 74.0183),
  ('Kolhapur',    'Maharashtra',    16.7050, 74.2433),
  ('Solapur',     'Maharashtra',    17.6599, 75.9064),
  ('Nashik',      'Maharashtra',    19.9975, 73.7898),
  ('Nagpur',      'Maharashtra',    21.1458, 79.0882),
  ('Belagavi',    'Karnataka',      15.8497, 74.4977),
  ('Hubballi',    'Karnataka',      15.3647, 75.1240),
  ('Davanagere',  'Karnataka',      14.4644, 75.9218),
  ('Chitradurga', 'Karnataka',      14.2251, 76.3980),
  ('Tumakuru',    'Karnataka',      13.3379, 77.1173),
  ('Bengaluru',   'Karnataka',      12.9716, 77.5946),
  ('Chennai',     'Tamil Nadu',     13.0827, 80.2707),
  ('Vellore',     'Tamil Nadu',     12.9165, 79.1325),
  ('Coimbatore',  'Tamil Nadu',     11.0168, 76.9558),
  ('Kochi',       'Kerala',          9.9312, 76.2673),
  ('Hyderabad',   'Telangana',      17.3850, 78.4867),
  ('Kurnool',     'Andhra Pradesh', 15.8281, 78.0373),
  ('Vijayawada',  'Andhra Pradesh', 16.5062, 80.6480),
  ('Surat',       'Gujarat',        21.1702, 72.8311),
  ('Vadodara',    'Gujarat',        22.3072, 73.1812),
  ('Ahmedabad',   'Gujarat',        23.0225, 72.5714),
  ('Udaipur',     'Rajasthan',      24.5854, 73.7125),
  ('Jaipur',      'Rajasthan',      26.9124, 75.7873),
  ('Delhi',       'Delhi',          28.6139, 77.2090),
  ('Agra',        'Uttar Pradesh',  27.1767, 78.0081),
  ('Kanpur',      'Uttar Pradesh',  26.4499, 80.3319),
  ('Lucknow',     'Uttar Pradesh',  26.8467, 80.9462),
  ('Indore',      'Madhya Pradesh', 22.7196, 75.8577),
  ('Bhopal',      'Madhya Pradesh', 23.2599, 77.4126),
  ('Kolkata',     'West Bengal',    22.5726, 88.3639);

insert into public.membership_tiers
  (id, name, monthly_price_inr, freight_discount_pct, priority, update_interval_sec, realtime_updates, ai_tracking, perks) values
  ('standard', 'Standard', 0,    0,  0, 30, false, false,
    array['Automated driver matching', 'Status refresh every 30 seconds', 'Delay and delivery alerts']),
  ('plus',     'Plus',     2999, 5,  1, 15, true,  false,
    array['5% lower freight on every booking', 'Instant push updates', 'City-by-city milestone alerts', 'Priority over Standard loads']),
  ('premium',  'Premium',  7999, 12, 2, 5,  true,  true,
    array['12% lower freight on every booking', 'Top dispatch priority', 'AI transport briefing', 'Live route map with reroute alerts', 'Instant push updates']);

insert into public.vehicle_types
  (id, name, capacity_kg, rate_per_km_inr, rate_max_per_km_inr, avg_speed_kmph, avoid_narrow_roads, suitable_cargo, routing_note) values
  -- Indian market rate card (Rs per km). Kept in step with supabase/upgrade.sql.
  ('mini_truck',   'Tata Ace',             750,   22, 30,  46, false, 'Small parcels, FMCG',           'Fits city lanes; fastest route is used.'),
  ('pickup',       'Pickup / Bada Dost',   1500,  26, 35,  48, false, 'Retail, agricultural goods',    'Fits city lanes; fastest route is used.'),
  ('lcv',          '14-ft truck',          3500,  31, 40,  50, false, 'Furniture, machinery, cartons', 'City roads allowed; fastest route is used.'),
  ('truck_17',     '17-ft truck',          5000,  34, 45,  48, false, 'Industrial / FMCG',             'City roads allowed; fastest route is used.'),
  ('hcv',          '19-ft truck',          7000,  37, 50,  48, true,  'Bulk goods',                    'Kept on national highways; narrow city roads avoided.'),
  ('container_20', '20-ft container',      8000,  41, 55,  44, true,  'Protected / valuable cargo',    'Kept on national highways; narrow city roads avoided.'),
  ('mxl',          '32-ft container',      18000, 55, 91,  42, true,  'Large commercial loads',        'Highway corridors only; bypasses used around city centres.'),
  ('trailer',      'Multi-axle / trailer', 25000, 65, 100, 38, true,  'Heavy industrial cargo',        'Highway corridors only; no ferries, bypasses around city centres.');

insert into public.admins (id, name, email) values
  ('a0000000-0000-4000-8000-000000000001', 'Logic Lanes Control Room', 'control@fleetpulse.demo');

-- ~15 demo clients
insert into public.clients (id, company_name, contact_name, email, phone, city, membership_tier, membership_since) values
  ('c0000000-0000-4000-8000-000000000001', 'Konkan Agro Exports',      'Anjali Deshmukh',  'anjali@konkanagro.demo',     '+91 98200 11001', 'Mumbai',     'premium',  current_date - 210),
  ('c0000000-0000-4000-8000-000000000002', 'Sahyadri Steel Works',     'Vikram Jadhav',    'vikram@sahyadristeel.demo',  '+91 98220 11002', 'Pune',       'plus',     current_date - 120),
  ('c0000000-0000-4000-8000-000000000003', 'Yamuna Ceramics',          'Pooja Bansal',     'pooja@yamunaceramics.demo',  '+91 98110 11003', 'Delhi',      'standard', current_date - 45),
  ('c0000000-0000-4000-8000-000000000004', 'Sabarmati Textiles',       'Hardik Shah',      'hardik@sabarmatitex.demo',   '+91 98250 11004', 'Ahmedabad',  'premium',  current_date - 300),
  ('c0000000-0000-4000-8000-000000000005', 'Deccan Auto Components',   'Kavya Reddy',      'kavya@deccanauto.demo',      '+91 98450 11005', 'Bengaluru',  'plus',     current_date - 90),
  ('c0000000-0000-4000-8000-000000000006', 'Marina Seafoods',          'Karthik Raman',    'karthik@marinasea.demo',     '+91 98400 11006', 'Chennai',    'standard', current_date - 30),
  ('c0000000-0000-4000-8000-000000000007', 'Charminar Pharma',         'Farah Siddiqui',   'farah@charminarpharma.demo', '+91 98490 11007', 'Hyderabad',  'premium',  current_date - 180),
  ('c0000000-0000-4000-8000-000000000008', 'Coorg Coffee Traders',     'Nikhil Gowda',     'nikhil@coorgcoffee.demo',    '+91 98440 11008', 'Bengaluru',  'standard', current_date - 60),
  ('c0000000-0000-4000-8000-000000000009', 'Pink City Handicrafts',    'Meera Rathore',    'meera@pinkcitycraft.demo',   '+91 98290 11009', 'Jaipur',     'standard', current_date - 15),
  ('c0000000-0000-4000-8000-000000000010', 'Hooghly Jute Mills',       'Arindam Ghosh',    'arindam@hooghlyjute.demo',   '+91 98300 11010', 'Kolkata',    'plus',     current_date - 150),
  ('c0000000-0000-4000-8000-000000000011', 'Malwa Soya Products',      'Rohit Tiwari',     'rohit@malwasoya.demo',       '+91 98260 11011', 'Indore',     'standard', current_date - 75),
  ('c0000000-0000-4000-8000-000000000012', 'Orange City Farm Fresh',   'Sneha Kulkarni',   'sneha@orangecityfresh.demo', '+91 98230 11012', 'Nagpur',     'plus',     current_date - 40),
  ('c0000000-0000-4000-8000-000000000013', 'Kovai Pumps & Motors',     'Senthil Kumar',    'senthil@kovaipumps.demo',    '+91 98430 11013', 'Coimbatore', 'standard', current_date - 20),
  ('c0000000-0000-4000-8000-000000000014', 'Tapi Diamond Tools',       'Jignesh Patel',    'jignesh@tapitools.demo',     '+91 98240 11014', 'Surat',      'premium',  current_date - 365),
  ('c0000000-0000-4000-8000-000000000015', 'Awadh Leather House',      'Zoya Ansari',      'zoya@awadhleather.demo',     '+91 98390 11015', 'Lucknow',    'standard', current_date - 10);

-- 6 drivers: 3 full-time employees, 3 gig workers
insert into public.drivers
  (id, name, phone, driver_type, status, vehicle_type, vehicle_number, home_city, current_city, current_lat, current_lng, rating, trips_completed, monthly_salary_inr) values
  ('d0000000-0000-4000-8000-000000000001', 'Ramesh Yadav',   '+91 99200 22001', 'full_time', 'on_trip',   'hcv',        'MH 04 GK 4821', 'Mumbai',    null,         15.0340, 75.4190, 4.8, 412, 38000),
  ('d0000000-0000-4000-8000-000000000002', 'Suresh Patil',   '+91 99250 22002', 'full_time', 'available', 'mxl',        'GJ 01 DX 7730', 'Ahmedabad', 'Mumbai',     19.0760, 72.8777, 4.6, 298, 42000),
  ('d0000000-0000-4000-8000-000000000003', 'Gurpreet Singh', '+91 99220 22003', 'full_time', 'available', 'lcv',        'MH 12 QR 1594', 'Pune',      'Pune',       18.5204, 73.8567, 4.7, 187, 32000),
  ('d0000000-0000-4000-8000-000000000004', 'Imran Khan',     '+91 99110 22004', 'gig',       'available', 'lcv',        'DL 1L AB 6042', 'Delhi',     'Delhi',      28.6139, 77.2090, 4.5, 96,  null),
  ('d0000000-0000-4000-8000-000000000005', 'Murugan Selvam', '+91 99400 22005', 'gig',       'available', 'hcv',        'TN 09 CZ 3317', 'Chennai',   'Coimbatore', 11.0168, 76.9558, 4.9, 143, null),
  ('d0000000-0000-4000-8000-000000000006', 'Bikram Das',     '+91 99490 22006', 'gig',       'available', 'mini_truck', 'TS 08 HM 2256', 'Hyderabad', 'Hyderabad',  17.3850, 78.4867, 4.3, 58,  null);

-- Shipments -------------------------------------------------------------------
insert into public.shipments
  (id, client_id, goods_description, goods_category, weight_kg, origin_city, dest_city, pickup_date, delivery_date,
   vehicle_type, status, priority, distance_km, quoted_price_inr, discount_pct, is_backhaul, created_at) values
  -- FP-1001: the ACTIVE delivery, Mumbai -> Bengaluru along NH48
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'Alphonso mango pulp, 240 sealed tins on 6 shrink-wrapped pallets. Keep dry, do not stack above 2 pallets.',
   'perishable', 6200, 'Mumbai', 'Bengaluru', current_date - 1, current_date + 1,
   'hcv', 'in_transit', 2, 984, 38800, 12, false, now() - interval '20 hours'),
  -- FP-1002..1004: open loads leaving Bengaluru, i.e. return-trip candidates for the truck arriving there
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000005',
   'Machined brake drums and axle housings, 18 wooden crates. Forklift required at both ends.',
   'machinery', 5400, 'Bengaluru', 'Mumbai', current_date + 1, current_date + 3,
   'hcv', 'pending', 1, 984, 37000, 5, false, now() - interval '3 hours'),
  ('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000008',
   'Roasted coffee beans and whole spices, 300 cartons. Keep away from moisture and strong odours.',
   'general', 2800, 'Bengaluru', 'Pune', current_date + 1, current_date + 3,
   'lcv', 'pending', 0, 838, 30900, 0, false, now() - interval '2 hours'),
  ('e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000007',
   'Tablet blister packs (non-refrigerated), 120 corrugated boxes. Fragile, this side up.',
   'fragile', 900, 'Bengaluru', 'Hyderabad', current_date + 2, current_date + 4,
   'pickup', 'pending', 2, 570, 13900, 12, false, now() - interval '1 hour'),
  -- FP-1005: offered to a gig driver, awaiting accept / reject
  ('e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003',
   'Vitrified floor tiles, 160 boxes on 4 pallets. Fragile, load upright only.',
   'fragile', 2200, 'Delhi', 'Jaipur', current_date + 1, current_date + 2,
   'lcv', 'offered', 0, 281, 9600, 0, false, now() - interval '25 minutes'),
  -- FP-1006..1007: delivered history
  ('e0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000004',
   'Printed cotton fabric rolls, 420 rolls in polythene wraps.',
   'general', 14500, 'Ahmedabad', 'Mumbai', current_date - 3, current_date - 2,
   'mxl', 'delivered', 2, 531, 36600, 12, false, now() - interval '4 days'),
  ('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000006',
   'Frozen prawns in insulated boxes, 90 boxes with dry ice.',
   'perishable', 3800, 'Chennai', 'Coimbatore', current_date - 2, current_date - 1,
   'truck_17', 'delivered', 0, 505, 18300, 0, false, now() - interval '3 days'),
  -- FP-1008: assigned to a full-time driver, ready to start
  ('e0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000002',
   'Cold-rolled steel coils, 3 coils on timber cradles. Chain and chock before moving.',
   'machinery', 3400, 'Pune', 'Nashik', current_date + 1, current_date + 2,
   'lcv', 'assigned', 1, 212, 8000, 5, false, now() - interval '5 hours');

-- Job cards -------------------------------------------------------------------
insert into public.job_cards
  (id, shipment_id, driver_id, status, goods_summary, ai_summary, ai_provider, waypoints, steps,
   route_source, route_version, distance_km, duration_min, progress, current_lat, current_lng, speed_kmph, eta,
   sim_multiplier, last_telemetry_at, is_backhaul, match_score, match_reason, offered_at, accepted_at, started_at, delivered_at) values
  -- The ACTIVE simulated delivery (62% complete, between Hubballi and Davanagere)
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'in_transit',
   'Alphonso mango pulp, 240 sealed tins on 6 shrink-wrapped pallets. Keep dry, do not stack above 2 pallets.',
   'Perishable goods, 6,200 kg. Route via NH48 through Pune, Kolhapur and Hubballi. Heavy truck kept on the national highway; city centres bypassed. Passing showers possible near Davanagere.',
   'deterministic',
   '[
     {"name": "Mumbai",     "lat": 19.0760, "lng": 72.8777, "kind": "origin",      "at": 0},
     {"name": "Pune",       "lat": 18.5204, "lng": 73.8567, "kind": "via",         "at": 0.139},
     {"name": "Satara",     "lat": 17.6805, "lng": 74.0183, "kind": "via",         "at": 0.248},
     {"name": "Kolhapur",   "lat": 16.7050, "lng": 74.2433, "kind": "via",         "at": 0.375},
     {"name": "Belagavi",   "lat": 15.8497, "lng": 74.4977, "kind": "via",         "at": 0.487},
     {"name": "Hubballi",   "lat": 15.3647, "lng": 75.1240, "kind": "via",         "at": 0.590},
     {"name": "Davanagere", "lat": 14.4644, "lng": 75.9218, "kind": "via",         "at": 0.748},
     {"name": "Tumakuru",   "lat": 13.3379, "lng": 77.1173, "kind": "via",         "at": 0.938},
     {"name": "Bengaluru",  "lat": 12.9716, "lng": 77.5946, "kind": "destination", "at": 1}
   ]'::jsonb,
   '[
     {"instruction": "Leave Mumbai on the Mumbai-Pune Expressway towards Pune",   "distance_km": 137, "at": 0},
     {"instruction": "Continue on NH48 towards Satara",                           "distance_km": 107, "at": 0.139},
     {"instruction": "Continue on NH48 towards Kolhapur",                         "distance_km": 125, "at": 0.248},
     {"instruction": "Cross into Karnataka on NH48 towards Belagavi",             "distance_km": 110, "at": 0.375},
     {"instruction": "Continue on NH48 towards Hubballi",                         "distance_km": 101, "at": 0.487},
     {"instruction": "Take the Hubballi bypass and continue on NH48 to Davanagere", "distance_km": 156, "at": 0.590},
     {"instruction": "Continue on NH48 past Chitradurga towards Tumakuru",        "distance_km": 187, "at": 0.748},
     {"instruction": "Follow NH48 into Bengaluru, exit at Peenya for unloading",  "distance_km": 61,  "at": 0.938}
   ]'::jsonb,
   'estimate', 1, 984, 1230, 0.62, 15.0340, 75.4190, 52, now() + interval '7 hours 45 minutes',
   1, now(), false, 85, 'Full-time driver based in Mumbai, right-sized heavy truck, 0 km empty run to pickup.',
   now() - interval '19 hours', now() - interval '19 hours', now() - interval '13 hours', null),

  -- Offer waiting on a gig driver
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000004',
   'offered',
   'Vitrified floor tiles, 160 boxes on 4 pallets. Fragile, load upright only.',
   'Fragile goods, 2,200 kg. Route via NH48 from Delhi to Jaipur. Light truck, city roads allowed at both ends.',
   'deterministic',
   '[
     {"name": "Delhi",  "lat": 28.6139, "lng": 77.2090, "kind": "origin",      "at": 0},
     {"name": "Jaipur", "lat": 26.9124, "lng": 75.7873, "kind": "destination", "at": 1}
   ]'::jsonb,
   '[{"instruction": "Leave Delhi on NH48 via Gurugram and continue to Jaipur", "distance_km": 281, "at": 0}]'::jsonb,
   'estimate', 1, 281, 337, 0, 28.6139, 77.2090, 0, null,
   1, now(), false, 72, 'Already in Delhi with a right-sized light truck, 0 km empty run to pickup.',
   now() - interval '25 minutes', null, null, null),

  -- Delivered history
  ('f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002',
   'delivered',
   'Printed cotton fabric rolls, 420 rolls in polythene wraps.',
   'General goods, 14,500 kg. Route via NH48 through Vadodara and Surat. Multi-axle kept on the highway corridor.',
   'deterministic',
   '[
     {"name": "Ahmedabad", "lat": 23.0225, "lng": 72.5714, "kind": "origin",      "at": 0},
     {"name": "Vadodara",  "lat": 22.3072, "lng": 73.1812, "kind": "via",         "at": 0.21},
     {"name": "Surat",     "lat": 21.1702, "lng": 72.8311, "kind": "via",         "at": 0.50},
     {"name": "Mumbai",    "lat": 19.0760, "lng": 72.8777, "kind": "destination", "at": 1}
   ]'::jsonb,
   '[]'::jsonb,
   'estimate', 1, 531, 758, 1, 19.0760, 72.8777, 0, now() - interval '2 days',
   1, now() - interval '2 days', false, 80, 'Full-time driver based in Ahmedabad with the only multi-axle in range.',
   now() - interval '4 days', now() - interval '4 days', now() - interval '3 days', now() - interval '2 days'),

  ('f0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000005',
   'delivered',
   'Frozen prawns in insulated boxes, 90 boxes with dry ice.',
   'Perishable goods, 3,800 kg. Route via NH48 and NH544 through Vellore and Salem. Heavy truck kept on the highway.',
   'deterministic',
   '[
     {"name": "Chennai",    "lat": 13.0827, "lng": 80.2707, "kind": "origin",      "at": 0},
     {"name": "Vellore",    "lat": 12.9165, "lng": 79.1325, "kind": "via",         "at": 0.27},
     {"name": "Coimbatore", "lat": 11.0168, "lng": 76.9558, "kind": "destination", "at": 1}
   ]'::jsonb,
   '[]'::jsonb,
   'estimate', 1, 505, 631, 1, 11.0168, 76.9558, 0, now() - interval '1 day',
   1, now() - interval '1 day', false, 74, 'Gig driver based in Chennai, accepted within 4 minutes.',
   now() - interval '3 days', now() - interval '3 days', now() - interval '2 days', now() - interval '1 day'),

  -- Assigned to a full-time driver, waiting for "Start trip"
  ('f0000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000003',
   'assigned',
   'Cold-rolled steel coils, 3 coils on timber cradles. Chain and chock before moving.',
   'Machinery, 3,400 kg. Route via NH60 from Pune through Sangamner to Nashik. Light truck, city roads allowed.',
   'deterministic',
   '[
     {"name": "Pune",   "lat": 18.5204, "lng": 73.8567, "kind": "origin",      "at": 0},
     {"name": "Nashik", "lat": 19.9975, "lng": 73.7898, "kind": "destination", "at": 1}
   ]'::jsonb,
   '[{"instruction": "Leave Pune on NH60 via Sangamner and continue to Nashik", "distance_km": 212, "at": 0}]'::jsonb,
   'estimate', 1, 212, 254, 0, 18.5204, 73.8567, 0, null,
   1, now(), false, 92, 'Full-time driver already in Pune, 0 km empty run to pickup.',
   now() - interval '5 hours', now() - interval '5 hours', null, null);

-- Notifications -----------------------------------------------------------------
insert into public.notifications (recipient_role, recipient_id, shipment_id, job_card_id, kind, title, body, read, created_at) values
  ('client', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'assignment', 'Driver assigned to FP-1001', 'Ramesh Yadav (MH 04 GK 4821, Heavy Truck) will carry your mango pulp to Bengaluru.', true, now() - interval '19 hours'),
  ('client', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'info', 'FP-1001 picked up', 'Your shipment left Mumbai and is on NH48.', true, now() - interval '13 hours'),
  ('client', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'milestone', 'FP-1001 crossed Hubballi', 'On schedule. About 375 km left to Bengaluru.', false, now() - interval '35 minutes'),
  ('driver', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'backhaul', 'Return loads waiting in Bengaluru', '3 loads are leaving Bengaluru after you arrive. Pick one so you do not drive back empty.', false, now() - interval '20 minutes'),
  ('driver', 'd0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000005',
   'offer', 'New job offer: Delhi to Jaipur', '2,200 kg of floor tiles, pickup tomorrow. Accept or reject from your dashboard.', false, now() - interval '25 minutes'),
  ('driver', 'd0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000008',
   'assignment', 'New assignment: Pune to Nashik', '3,400 kg of steel coils, pickup tomorrow. Tap Start trip when loaded.', false, now() - interval '5 hours'),
  ('client', 'c0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000008',
   'assignment', 'Driver assigned to FP-1008', 'Gurpreet Singh (MH 12 QR 1594, Light Truck) will carry your steel coils to Nashik.', false, now() - interval '5 hours'),
  ('client', 'c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000005',
   'info', 'FP-1005 offered to a driver', 'We offered your load to Imran Khan in Delhi. You will be notified when it is accepted.', false, now() - interval '25 minutes'),
  ('client', 'c0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000006',
   'delivered', 'FP-1006 delivered', 'Your fabric rolls reached Mumbai.', true, now() - interval '2 days'),
  ('client', 'c0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000007',
   'delivered', 'FP-1007 delivered', 'Your frozen prawns reached Coimbatore.', true, now() - interval '1 day');

-- The seed inserts above fired the live-event triggers; start with a clean queue.
delete from public.live_events;
