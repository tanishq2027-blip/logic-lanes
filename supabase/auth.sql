-- =============================================================================
-- Logic Lanes — Supabase Auth integration
--
-- Run this AFTER supabase/schema.sql, in the Supabase SQL Editor.
-- It is additive and safe to run again. Re-run it whenever you re-run
-- schema.sql, because schema.sql recreates the clients and drivers tables.
--
-- What it adds:
--   1. clients.client_type  (individual | company)
--   2. drivers.email        (drivers sign in with email + passcode)
--   3. public.profiles      (one row per auth user: role, client/driver type, contact)
--   4. A trigger on auth.users that fills public.profiles on sign-up and
--      creates the matching row in clients or drivers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns on the portal tables
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists client_type text not null default 'company'
    check (client_type in ('individual', 'company'));

alter table public.drivers
  add column if not exists email text;

create unique index if not exists drivers_email_key on public.drivers (lower(email));

-- Seeded demo drivers get an email so they can be given a login
-- (see scripts/seed-demo-users.mjs).
update public.drivers d
set email = v.email
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'ramesh.yadav@fleetpulse.demo'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'suresh.patil@fleetpulse.demo'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'gurpreet.singh@fleetpulse.demo'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'imran.khan@fleetpulse.demo'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, 'murugan.selvam@fleetpulse.demo'),
  ('d0000000-0000-4000-8000-000000000006'::uuid, 'bikram.das@fleetpulse.demo')
) as v (id, email)
where d.id = v.id and d.email is null;

-- ---------------------------------------------------------------------------
-- 2. Profiles: one row per Supabase Auth user
--    Plain text + check constraints (not the schema.sql enums) so that
--    re-running schema.sql never has to drop this table.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('client', 'driver')),
  client_type text check (client_type in ('individual', 'company')),
  driver_type text check (driver_type in ('gig', 'full_time')),
  full_name   text not null,
  phone       text not null default '',
  email       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- a client has a client_type and no driver_type, and the other way round
  constraint profile_type_matches_role check (
    (role = 'client' and client_type is not null and driver_type is null)
    or (role = 'driver' and driver_type is not null and client_type is null)
  )
);

create index if not exists profiles_role_idx on public.profiles (role);

alter table public.profiles enable row level security;

-- A signed-in user may read their own profile. Nobody can change a profile
-- through the API: the role must not be editable by its owner. The server
-- (service role) and the trigger below are the only writers.
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles
  for select to authenticated using (public.is_admin());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger: sync auth.users -> public.profiles (+ clients / drivers)
--
-- The app signs users up with this metadata:
--   { role, client_type | driver_type, full_name, phone, city,
--     vehicle_type, vehicle_number }
-- Users without a role in their metadata (for example ones created by hand in
-- the Supabase dashboard, or by scripts/seed-demo-users.mjs, which links the
-- seeded personas itself) are left alone.
--
-- If this function raises, Supabase rolls the sign-up back, so an auth user
-- can never exist without its profile and portal row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta          jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role        text  := meta->>'role';
  v_email       text  := coalesce(new.email, '');
  v_name        text  := coalesce(nullif(trim(meta->>'full_name'), ''), split_part(coalesce(new.email, 'user'), '@', 1));
  v_phone       text  := coalesce(nullif(trim(meta->>'phone'), ''), '');
  v_client_type text  := case when meta->>'client_type' in ('individual', 'company') then meta->>'client_type' else 'individual' end;
  v_driver_type text  := case when meta->>'driver_type' in ('gig', 'full_time') then meta->>'driver_type' else 'gig' end;
  v_city        text;
  v_vehicle     text;
  v_number      text;
begin
  if v_role is null or v_role not in ('client', 'driver') then
    return new;
  end if;

  -- Metadata is typed by the user, so never trust it to reference real rows.
  select name into v_city from public.cities where name = meta->>'city';
  if v_city is null then
    select name into v_city from public.cities order by name limit 1;
  end if;

  insert into public.profiles (id, role, client_type, driver_type, full_name, phone, email)
  values (
    new.id,
    v_role,
    case when v_role = 'client' then v_client_type end,
    case when v_role = 'driver' then v_driver_type end,
    v_name,
    v_phone,
    v_email
  )
  on conflict (id) do update set
    role        = excluded.role,
    client_type = excluded.client_type,
    driver_type = excluded.driver_type,
    full_name   = excluded.full_name,
    phone       = excluded.phone,
    email       = excluded.email,
    updated_at  = now();

  if v_role = 'client' then
    insert into public.clients (auth_user_id, company_name, contact_name, email, phone, city, client_type)
    values (new.id, v_name, v_name, v_email, v_phone, v_city, v_client_type);
  else
    select id into v_vehicle from public.vehicle_types where id = meta->>'vehicle_type';
    if v_vehicle is null then
      select id into v_vehicle from public.vehicle_types order by capacity_kg limit 1;
    end if;
    v_number := coalesce(
      nullif(upper(trim(meta->>'vehicle_number')), ''),
      'UNREGISTERED-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))
    );

    insert into public.drivers
      (auth_user_id, name, phone, email, driver_type, status, vehicle_type, vehicle_number,
       home_city, current_city, current_lat, current_lng, monthly_salary_inr)
    select
      new.id, v_name, v_phone, v_email, v_driver_type::public.driver_type, 'available', v_vehicle, v_number,
      c.name, c.name, c.lat, c.lng,
      case when v_driver_type = 'full_time' then 30000 end
    from public.cities c
    where c.name = v_city;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the profile's email in step if the user changes it in Supabase Auth.
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = coalesce(new.email, ''), updated_at = now() where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- 4. Tighten RLS now that real users hold real tokens
--
-- With Supabase Auth a signed-in user can call the Data API directly with
-- their own token. Every write in the app goes through the server, which
-- validates and prices it, so users must not be able to write these tables
-- themselves (for example to upgrade their own plan, set their own freight
-- price or move their own truck). Reads of their own rows stay allowed.
-- ---------------------------------------------------------------------------
drop policy if exists "clients update own profile"   on public.clients;
drop policy if exists "drivers update own profile"   on public.drivers;
drop policy if exists "clients book shipments"       on public.shipments;
drop policy if exists "drivers update own job cards" on public.job_cards;
