import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { LiveRefresh } from '@/components/LiveRefresh';
import { FadeIn } from '@/components/Motion';
import { NotificationFeed, type FeedItem } from '@/components/NotificationFeed';
import { SetupNotice } from '@/components/SetupNotice';
import { Toaster } from '@/components/Toaster';
import { FleetMap } from '@/components/driver/FleetMap';
import { JobCardPanel } from '@/components/driver/JobCardPanel';
import { OpenLoadCard } from '@/components/driver/OpenLoadCard';
import { ReturnLoadPrompt } from '@/components/driver/ReturnLoadPrompt';
import { WalletButton } from '@/components/driver/WalletButton';
import { getDriverDashboard, type DriverDashboard } from '@/lib/data';
import { dateShort, inr, kgs, timeAgo } from '@/lib/format';
import { effectivePath, nearestCity, pointAtProgress } from '@/lib/geo';
import { driverPayout } from '@/lib/pricing';
import { routingProfile } from '@/lib/routing';
import { requireSession } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Driver portal' };

export default async function DriverPortal() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const session = await requireSession('driver');

  let data: DriverDashboard | null;
  try {
    data = await getDriverDashboard(getDb(), session.id);
  } catch (err) {
    return <SetupNotice error={err instanceof Error ? err.message : 'Unknown error'} />;
  }
  if (!data) redirect('/?portal=driver');

  const { driver, vehicle, jobs, shipments, clients, incidents, notifications, returnLoads, openLoads, wallet, cities } = data;
  const gig = driver.driver_type === 'gig';
  const running = jobs.find((j) => j.status === 'in_transit');
  const offers = jobs.filter((j) => j.status === 'offered');
  const assigned = jobs.filter((j) => j.status === 'assigned');
  const delivered = jobs.filter((j) => j.status === 'delivered');

  // The job on the map: the running trip, else the next one to start, else the newest offer.
  const focus = running ?? assigned[0] ?? offers[0];
  const others = [...offers, ...assigned].filter((j) => j.id !== focus?.id);
  const shipmentOf = (jobId: string) => shipments.find((s) => s.id === jobs.find((j) => j.id === jobId)?.shipment_id);
  const focusShipment = focus ? shipmentOf(focus.id) : undefined;
  const profile = routingProfile(vehicle);
  const here = driver.current_city ?? driver.home_city;

  // Notifications lead somewhere: to the Job Card they are about, or to the list of loads on offer.
  const liveJobIds = new Set([...offers, ...assigned, ...(running ? [running] : [])].map((j) => j.id));
  const openOfferIds = new Set(offers.map((j) => j.id));
  const feed: FeedItem[] = notifications.map((n) => {
    const item: FeedItem = { ...n, ago: timeAgo(n.created_at) };
    if (n.job_card_id && openOfferIds.has(n.job_card_id) && n.kind === 'offer') {
      item.offerJobId = n.job_card_id;
      item.href = `#job-${n.job_card_id}`;
      item.hrefLabel = 'Open the Job Card';
    } else if (n.kind === 'backhaul' && openLoads.length > 0) {
      item.href = '#loads';
      item.hrefLabel = 'See the loads';
    } else if (n.kind === 'backhaul' && returnLoads.length > 0 && running) {
      // While on a trip, return loads are listed at the bottom of the running Job Card.
      item.href = `#job-${running.id}`;
      item.hrefLabel = 'See the loads';
    } else if (n.job_card_id && liveJobIds.has(n.job_card_id)) {
      item.href = `#job-${n.job_card_id}`;
      item.hrefLabel = 'Open the Job Card';
    }
    return item;
  });

  let nearName = here;
  if (focus) {
    const at = pointAtProgress(effectivePath(focus), Number(focus.progress));
    nearName = nearestCity(at, cities)?.city.name ?? nearName;
  }

  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date());

  return (
    <>
      <AppHeader name={driver.name} role={`${gig ? 'Gig driver' : 'Full-time driver'} · ${driver.vehicle_number}`} session="driver" />
      <Toaster />
      <main className="shell py-8 sm:py-12">
        <FadeIn className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Driver portal</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Namaste, {driver.name.split(' ')[0]}</h1>
            <p className="mt-1 font-bold text-noir/70">
              {vehicle.name} · {gig ? 'You choose your jobs' : 'Jobs are assigned to you first'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">
              <Icon name="star" size={16} /> {Number(driver.rating).toFixed(1)}
            </span>
            <WalletButton
              wallet={{ ...wallet, entries: wallet.entries.map((e) => ({ ...e, date: dateShort(e.delivered_at) })) }}
              gig={gig}
              salary={driver.monthly_salary_inr}
              monthName={monthName}
            />
            <LiveRefresh topic={driver.id} realtime intervalSec={5} />
          </div>
        </FadeIn>

        {focus && focusShipment ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
            <FadeIn delay={0.05} className="h-[62vh] min-h-[440px] lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
              <FleetMap job={focus} incidents={incidents.slice(0, 1)} nearName={nearName} destName={focusShipment.dest_city}>
                {returnLoads[0] ? <ReturnLoadPrompt load={returnLoads[0]} city={focusShipment.dest_city} gig={gig} /> : null}
              </FleetMap>
            </FadeIn>

            <FadeIn delay={0.1} className="space-y-6">
              <JobCardPanel
                job={focus}
                shipment={focusShipment}
                clientName={clients.find((c) => c.id === focusShipment.client_id)?.company_name ?? 'Client'}
                vehicle={vehicle}
                routingLabel={profile.label}
                gig={gig}
                payout={driverPayout(focusShipment.quoted_price_inr, driver.driver_type)}
                incident={incidents[0]}
                returnLoads={returnLoads}
                tripRunning={Boolean(running) && focus.id !== running?.id}
              />
            </FadeIn>
          </div>
        ) : (
          <FadeIn delay={0.05} className="card mt-8">
            <h2 className="text-2xl font-black">No job right now</h2>
            <p className="mt-2 text-lg font-semibold text-noir/75">
              You are marked available in {here}.{' '}
              {openLoads.length > 0
                ? `${openLoads.length} order${openLoads.length === 1 ? ' is' : 's are'} waiting near you. Accept one below to get moving.`
                : `${gig ? 'New offers' : 'New assignments'} will appear here and ring as a notification.`}
            </p>
          </FadeIn>
        )}

        {/* Incoming orders an available driver can accept or reject. */}
        {openLoads.length > 0 ? (
          <FadeIn delay={0.1} className="mt-14">
            <section id="loads" className="scroll-mt-28" aria-labelledby="loads-title">
              <h2 id="loads-title" className="flex flex-wrap items-center gap-2 text-2xl font-black">
                <Icon name="box" size={26} className="text-midnight" />
                Orders near you
                <span className="chip-alert">{openLoads.length} waiting</span>
              </h2>
              <div className="mt-6 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
                {openLoads.map((load) => (
                  <OpenLoadCard key={load.shipment.id} load={load} gig={gig} />
                ))}
              </div>
            </section>
          </FadeIn>
        ) : null}

        {others.length > 0 ? (
          <FadeIn delay={0.15} className="mt-14">
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Icon name="truck" size={26} className="text-midnight" />
              Lined up next
            </h2>
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              {others.map((job) => {
                const shipment = shipmentOf(job.id);
                if (!shipment) return null;
                return (
                  <JobCardPanel
                    key={job.id}
                    job={job}
                    shipment={shipment}
                    clientName={clients.find((c) => c.id === shipment.client_id)?.company_name ?? 'Client'}
                    vehicle={vehicle}
                    routingLabel={profile.label}
                    gig={gig}
                    payout={driverPayout(shipment.quoted_price_inr, driver.driver_type)}
                    returnLoads={[]}
                    tripRunning={Boolean(running)}
                  />
                );
              })}
            </div>
          </FadeIn>
        ) : null}

        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <FadeIn delay={0.2}>
            <NotificationFeed items={feed} role="driver" />
          </FadeIn>

          <FadeIn delay={0.25}>
            <section aria-labelledby="done-title">
              <h2 id="done-title" className="flex items-center gap-2 text-2xl font-black">
                <Icon name="check" size={26} className="text-midnight" />
                Completed trips
              </h2>
              {delivered.length === 0 ? (
                <p className="muted mt-4 font-semibold">Your delivered trips will be listed here.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {delivered.map((job) => {
                    const shipment = shipmentOf(job.id);
                    if (!shipment) return null;
                    return (
                      <li key={job.id} className="flex items-center justify-between gap-3 rounded-2xl border border-noir/15 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-extrabold">
                            {shipment.reference} · {shipment.origin_city} to {shipment.dest_city}
                          </p>
                          <p className="text-sm font-bold text-noir/65">
                            {kgs(shipment.weight_kg)} · delivered {job.delivered_at ? dateShort(job.delivered_at) : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-lg font-black">{inr(driverPayout(shipment.quoted_price_inr, driver.driver_type))}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </FadeIn>
        </div>
      </main>
    </>
  );
}
