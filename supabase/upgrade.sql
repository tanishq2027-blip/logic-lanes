-- =============================================================================
-- Logic Lanes — upgrades added after the first schema
--
-- Run this whole file in the Supabase SQL Editor (after schema.sql and
-- auth.sql). Everything in it is additive and safe to run again. Re-run it
-- whenever you re-run schema.sql, because schema.sql recreates these tables.
--
--   1. SOS flag on Job Cards
--   2. Indian per-km rate card for vehicle classes
--   3. Payment flag on shipments
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SOS / emergency
--    The shipment keeps its normal status (it is still "in transit"); the SOS
--    is a separate flag, so tracking, the map and delivery keep working.
-- ---------------------------------------------------------------------------
alter table public.job_cards
  add column if not exists sos_at          timestamptz,   -- when the driver raised the SOS
  add column if not exists sos_resolved_at timestamptz;   -- when the driver or the control room cleared it

comment on column public.job_cards.sos_at is 'Set when the driver triggers an SOS. An SOS is open while sos_at is set and sos_resolved_at is null.';

create index if not exists job_cards_open_sos_idx on public.job_cards (sos_at) where sos_at is not null and sos_resolved_at is null;

-- ---------------------------------------------------------------------------
-- 2. Rate card
--    Each vehicle class has a per-km rate BAND. A light load for the class is
--    priced near the bottom of the band and a full load near the top.
--
--      Load          Vehicle              Rs/km     Suitable cargo
--      0-750 kg      Tata Ace             22-30     Small parcels, FMCG
--      750 kg-1.5 T  Pickup / Bada Dost   26-35     Retail, agricultural goods
--      1.5-3.5 T     14-ft truck          31-40     Furniture, machinery, cartons
--      3.5-5 T       17-ft truck          34-45     Industrial / FMCG
--      5-7 T         19-ft truck          37-50     Bulk goods
--      6-8 T         20-ft container      41-55     Protected / valuable cargo
--      7-18 T        32-ft container      55-91     Large commercial loads
--      15-25 T       Multi-axle / trailer 65-100    Heavy industrial cargo
-- ---------------------------------------------------------------------------
alter table public.vehicle_types
  add column if not exists rate_max_per_km_inr numeric(8,2),   -- top of the band; rate_per_km_inr is the bottom
  add column if not exists suitable_cargo      text not null default '';

insert into public.vehicle_types
  (id, name, capacity_kg, rate_per_km_inr, rate_max_per_km_inr, avg_speed_kmph, avoid_narrow_roads, suitable_cargo, routing_note) values
  ('mini_truck',   'Tata Ace',             750,   22, 30,  46, false, 'Small parcels, FMCG',           'Fits city lanes; fastest route is used.'),
  ('pickup',       'Pickup / Bada Dost',   1500,  26, 35,  48, false, 'Retail, agricultural goods',    'Fits city lanes; fastest route is used.'),
  ('lcv',          '14-ft truck',          3500,  31, 40,  50, false, 'Furniture, machinery, cartons', 'City roads allowed; fastest route is used.'),
  ('truck_17',     '17-ft truck',          5000,  34, 45,  48, false, 'Industrial / FMCG',             'City roads allowed; fastest route is used.'),
  ('hcv',          '19-ft truck',          7000,  37, 50,  48, true,  'Bulk goods',                    'Kept on national highways; narrow city roads avoided.'),
  ('container_20', '20-ft container',      8000,  41, 55,  44, true,  'Protected / valuable cargo',    'Kept on national highways; narrow city roads avoided.'),
  ('mxl',          '32-ft container',      18000, 55, 91,  42, true,  'Large commercial loads',        'Highway corridors only; bypasses used around city centres.'),
  ('trailer',      'Multi-axle / trailer', 25000, 65, 100, 38, true,  'Heavy industrial cargo',        'Highway corridors only; no ferries, bypasses around city centres.')
on conflict (id) do update set
  name                = excluded.name,
  capacity_kg         = excluded.capacity_kg,
  rate_per_km_inr     = excluded.rate_per_km_inr,
  rate_max_per_km_inr = excluded.rate_max_per_km_inr,
  avg_speed_kmph      = excluded.avg_speed_kmph,
  avoid_narrow_roads  = excluded.avoid_narrow_roads,
  suitable_cargo      = excluded.suitable_cargo,
  routing_note        = excluded.routing_note;

-- ---------------------------------------------------------------------------
-- 3. Payments
--    A delivered shipment stays `delivered`; `paid_at` records when the client
--    marked it as paid. The app does not verify UPI payments: this is the
--    client's own declaration, for the control room to reconcile.
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column if not exists paid_at timestamptz;

comment on column public.shipments.paid_at is 'When the client marked the freight as paid by UPI. Self-declared; not verified against a bank or payment provider.';
