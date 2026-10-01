import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { LiveRefresh } from '@/components/LiveRefresh';
import { FadeIn } from '@/components/Motion';
import { NotificationFeed } from '@/components/NotificationFeed';
import { SetupNotice } from '@/components/SetupNotice';
import { Toaster } from '@/components/Toaster';
import { AdminGate } from '@/components/admin/AdminGate';
import { RouteConsole, type ConsoleRoute } from '@/components/admin/RouteConsole';
import { getAdminOverview, type AdminOverview } from '@/lib/data';
import { JOB_STATUS, SHIPMENT_STATUS, dateTime, inr, kgs, km, timeAgo } from '@/lib/format';
import { effectivePath } from '@/lib/geo';
import { sosOpen } from '@/lib/types';
import { getSession } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Control room', robots: { index: false, follow: false } };

/** Hidden Admin Panel. Reached by triple-clicking the footer logo or pressing Ctrl + Shift + A on the landing page. */
export default async function AdminPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const session = await getSession('admin');
  if (!session) return <AdminGate passcodeSet={Boolean(process.env.ADMIN_PASSCODE)} />;

  let data: AdminOverview;
  try {
    data = await getAdminOverview(getDb());
  } catch (err) {
    return <SetupNotice error={err instanceof Error ? err.message : 'Unknown error'} />;
  }

  const { clients, drivers, shipments, jobs, incidents, notifications, tiers, vehicles } = data;
  const shipmentById = new Map(shipments.map((s) => [s.id, s]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const jobByShipment = new Map(jobs.map((j) => [j.shipment_id, j]));

  const toRoute = (job: (typeof jobs)[number]): ConsoleRoute | null => {
    const shipment = shipmentById.get(job.shipment_id);
    if (!shipment || (job.status !== 'in_transit' && job.status !== 'delivered')) return null;
    return {
      jobId: job.id,
      reference: shipment.reference,
      lane: `${shipment.origin_city} to ${shipment.dest_city}`,
      driver: driverById.get(job.driver_id)?.name ?? 'Driver',
      client: clientById.get(shipment.client_id)?.company_name ?? 'Client',
      status: job.status,
      progress: Number(job.progress),
      distance_km: Number(job.distance_km),
      speed_kmph: job.speed_kmph,
      eta: job.eta,
      sim_multiplier: job.sim_multiplier,
      route_version: job.route_version,
      sos: job.status === 'in_transit' && sosOpen(job) && job.sos_at ? dateTime(job.sos_at) : null,
      driverPhone: driverById.get(job.driver_id)?.phone ?? '',
      route_source: job.route_source,
      ai_provider: job.ai_provider,
      path: effectivePath(job),
      waypoints: job.waypoints,
      incidents: incidents.filter((i) => i.job_card_id === job.id).slice(0, 1).map((i) => ({ lat: i.lat, lng: i.lng })),
    };
  };
  const activeRoutes = jobs.filter((j) => j.status === 'in_transit').map(toRoute).filter((r): r is ConsoleRoute => r !== null);
  const replayable = jobs.filter((j) => j.status === 'delivered').slice(0, 2).map(toRoute).filter((r): r is ConsoleRoute => r !== null);

  const backhauls = shipments.filter((s) => s.is_backhaul);
  const emptyKmAvoided = backhauls.reduce((sum, s) => sum + Number(s.distance_km), 0);
  const stats = [
    { label: 'Clients', value: String(clients.length) },
    { label: 'Drivers on trip', value: `${drivers.filter((d) => d.status === 'on_trip').length} of ${drivers.length}` },
    { label: 'Active routes', value: String(activeRoutes.length) },
    { label: 'Open loads', value: String(shipments.filter((s) => s.status === 'pending').length) },
    { label: 'Return-trip matches', value: String(backhauls.length) },
    { label: 'Empty km avoided', value: km(emptyKmAvoided) },
  ];
  const engines = [
    { label: 'Google Gemini', on: Boolean(process.env.GEMINI_API_KEY), note: 'primary LLM' },
    { label: 'Groq', on: Boolean(process.env.GROQ_API_KEY), note: 'failover LLM' },
    { label: 'Built-in engine', on: true, note: 'always available' },
    { label: 'OpenStreetMap', on: true, note: 'map tiles, no key needed' },
    { label: 'OpenRouteService', on: Boolean(process.env.ORS_API_KEY), note: 'road routes, truck profile' },
    process.env.WEATHERAPI_KEY
      ? { label: 'WeatherAPI.com', on: true, note: 'live weather' }
      : { label: 'OpenWeather', on: Boolean(process.env.OPENWEATHER_API_KEY), note: 'Open-Meteo used when off' },
  ];
  const feed = notifications.map((n) => ({ ...n, ago: timeAgo(n.created_at) }));

  return (
    <>
      <AppHeader name={session.name} role="Admin" session="admin" />
      <Toaster />
      <main className="shell py-8 sm:py-12">
        <FadeIn className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Admin panel</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Control room</h1>
          </div>
          <LiveRefresh topic="admin" realtime intervalSec={5} />
        </FadeIn>

        <FadeIn delay={0.05} className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="glass rounded-card p-5">
              <p className="text-sm font-bold text-noir/65">{s.label}</p>
              <p className="mt-1 text-2xl font-black">{s.value}</p>
            </div>
          ))}
        </FadeIn>

        <FadeIn delay={0.08} className="mt-4 flex flex-wrap gap-2" >
          {engines.map((e) => (
            <span key={e.label} className={e.on ? 'chip-solid' : 'chip border-dashed'} title={e.note}>
              <Icon name={e.on ? 'check' : 'x'} size={14} />
              {e.label}
              <span className="font-semibold opacity-75">· {e.on ? e.note : 'no key'}</span>
            </span>
          ))}
        </FadeIn>

        <FadeIn delay={0.1} className="mt-14">
          <h2 className="flex items-center gap-2 text-2xl font-black">
            <Icon name="route" size={26} className="text-midnight" />
            Active routes
          </h2>
          {activeRoutes.length === 0 ? (
            <p className="card-flat mt-4 font-bold text-noir/70">No truck is on the road. Replay a delivered trip below, or start one from a driver account.</p>
          ) : (
            <div className="mt-4 space-y-5">
              {activeRoutes.map((r) => (
                <RouteConsole key={r.jobId} route={r} />
              ))}
            </div>
          )}
        </FadeIn>

        {replayable.length > 0 ? (
          <FadeIn delay={0.12} className="mt-14">
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Icon name="refresh" size={26} className="text-midnight" />
              Replay a delivered trip
            </h2>
            <div className="mt-4 space-y-5">
              {replayable.map((r) => (
                <RouteConsole key={r.jobId} route={r} />
              ))}
            </div>
          </FadeIn>
        ) : null}

        <FadeIn delay={0.15} className="mt-14">
          <h2 className="flex items-center gap-2 text-2xl font-black">
            <Icon name="box" size={26} className="text-midnight" />
            Shipments
          </h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>Ref</Th>
                <Th>Client</Th>
                <Th>Lane</Th>
                <Th>Load</Th>
                <Th>Status</Th>
                <Th>Driver</Th>
                <Th>Freight</Th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const job = jobByShipment.get(s.id);
                const driver = job ? driverById.get(job.driver_id) : undefined;
                return (
                  <tr key={s.id} className="border-t border-noir/10">
                    <Td strong>{s.reference}</Td>
                    <Td>{clientById.get(s.client_id)?.company_name ?? ''}</Td>
                    <Td>
                      {s.origin_city} to {s.dest_city}
                      {s.is_backhaul ? <span className="chip-solid ml-2 px-2 py-0.5 text-xs">Return trip</span> : null}
                    </Td>
                    <Td>{kgs(s.weight_kg)}</Td>
                    <Td strong>
                      {SHIPMENT_STATUS[s.status]}
                      {s.status === 'delivered' ? (s.paid_at ? ' · paid' : ' · payment due') : ''}
                    </Td>
                    <Td>{driver ? `${driver.name}${job ? ` (${JOB_STATUS[job.status]})` : ''}` : 'Unassigned'}</Td>
                    <Td>{inr(s.quoted_price_inr)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </FadeIn>

        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <FadeIn delay={0.18}>
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Icon name="truck" size={26} className="text-midnight" />
              Drivers
            </h2>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Truck</Th>
                  <Th>Status</Th>
                  <Th>Where</Th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-t border-noir/10">
                    <Td strong>{d.name}</Td>
                    <Td>{d.driver_type === 'gig' ? 'Gig' : 'Full-time'}</Td>
                    <Td>{vehicles.find((v) => v.id === d.vehicle_type)?.name ?? d.vehicle_type}</Td>
                    <Td strong>{d.status === 'on_trip' ? 'On trip' : d.status === 'available' ? 'Available' : 'Offline'}</Td>
                    <Td>{d.current_city ?? 'On the road'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </FadeIn>

          <FadeIn delay={0.2}>
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Icon name="user" size={26} className="text-midnight" />
              Clients
            </h2>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th>Contact</Th>
                  <Th>City</Th>
                  <Th>Plan</Th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-t border-noir/10">
                    <Td strong>{c.company_name}</Td>
                    <Td>{c.contact_name}</Td>
                    <Td>{c.city}</Td>
                    <Td strong>{tiers.find((t) => t.id === c.membership_tier)?.name ?? c.membership_tier}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </FadeIn>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <FadeIn delay={0.22}>
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Icon name="alert" size={26} className="text-midnight" />
              Incident log
            </h2>
            {incidents.length === 0 ? (
              <p className="muted mt-4 font-semibold">No incidents yet. Simulate one on an active route.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {incidents.map((i) => (
                  <li key={i.id} className="rounded-2xl border border-noir/15 p-4">
                    <p className="font-extrabold capitalize">
                      {i.type.replace('_', ' ')} · severity {i.severity} · {i.source === 'admin' ? 'simulated' : 'automatic'}
                    </p>
                    <p className="mt-1 text-[0.95rem] font-medium text-noir/75">{i.description}</p>
                    <p className="mt-1 text-sm font-bold text-noir/55">{dateTime(i.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </FadeIn>
          <FadeIn delay={0.24}>
            <NotificationFeed items={feed} />
          </FadeIn>
        </div>
      </main>
    </>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass mt-6 overflow-x-auto rounded-card">
      <table className="w-full min-w-[560px] text-left text-[0.95rem]">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="bg-midnight px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-pearl">{children}</th>;
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`px-4 py-3 align-top ${strong ? 'font-extrabold' : 'font-semibold text-noir/80'}`}>{children}</td>;
}
