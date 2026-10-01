import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { LiveRefresh } from '@/components/LiveRefresh';
import { FadeIn } from '@/components/Motion';
import { NotificationFeed, type FeedItem } from '@/components/NotificationFeed';
import { SetupNotice } from '@/components/SetupNotice';
import { Toaster } from '@/components/Toaster';
import { BookingForm } from '@/components/client/BookingForm';
import { MembershipPlans } from '@/components/client/MembershipPlans';
import { ShipmentCard } from '@/components/client/ShipmentCard';
import { FleetAvailability, OrderHistory } from '@/components/client/Sidebar';
import { getClientDashboard, type ClientDashboard } from '@/lib/data';
import { inr, timeAgo, today } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client portal' };

export default async function ClientPortal() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const session = await requireSession('client');

  let data: ClientDashboard | null;
  try {
    data = await getClientDashboard(getDb(), session.id);
  } catch (err) {
    return <SetupNotice error={err instanceof Error ? err.message : 'Unknown error'} />;
  }
  if (!data) redirect('/?portal=client');

  const { client, tier, shipments, jobs, drivers, vehicles, cities, tiers, notifications, fleet } = data;
  // On-the-road shipments first: they carry the live map.
  // A delivered shipment stays here until it is paid: that is where its payment QR is shown.
  const rank = { in_transit: 0, delivered: 1, assigned: 2, offered: 3, pending: 4, cancelled: 5 } as const;
  const active = shipments
    .filter((s) => (s.status === 'delivered' ? !s.paid_at : s.status !== 'cancelled'))
    .sort((a, b) => rank[a.status] - rank[b.status]);
  const past = shipments.filter((s) => s.status === 'delivered');
  const settled = past.filter((s) => s.paid_at);
  const onRoad = shipments.filter((s) => s.status === 'in_transit').length;
  const saved = shipments.reduce((sum, s) => {
    const pct = Number(s.discount_pct);
    return pct > 0 && pct < 100 ? sum + (s.quoted_price_inr / (1 - pct / 100)) * (pct / 100) : sum;
  }, 0);

  // A notification about a shipment that is still open leads to its card.
  const activeIds = new Set(active.map((s) => s.id));
  const feed: FeedItem[] = notifications.map((n) => ({
    ...n,
    ago: timeAgo(n.created_at),
    ...(n.shipment_id && activeIds.has(n.shipment_id) ? { href: `#shipment-${n.shipment_id}`, hrefLabel: 'View shipment' } : {}),
  }));

  return (
    <>
      <AppHeader name={client.company_name} role={`Client · ${tier.name} member`} session="client" />
      <Toaster />
      <main className="shell-wide py-8 sm:py-12">
        <FadeIn className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Client portal</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Namaste, {client.contact_name.split(' ')[0]}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-solid">
              <Icon name="star" size={16} />
              {tier.name}
            </span>
            <LiveRefresh topic={client.id} realtime={tier.realtime_updates} intervalSec={tier.update_interval_sec} />
          </div>
        </FadeIn>

        <FadeIn delay={0.05} className="mt-8 grid grid-cols-3 gap-4 sm:gap-6">
          <Stat label="On the road" value={String(onRoad)} />
          <Stat label="Delivered" value={String(past.length)} />
          <Stat label="Saved so far" value={inr(saved)} />
        </FadeIn>

        {/* Booking form | shipments and notifications | history and fleet.
            Three columns from 1280px up; below that the right panel drops underneath as two side-by-side boxes. */}
        <div className="mt-10 grid gap-8 xl:gap-10 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,300px)] 2xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,340px)]">
          <FadeIn delay={0.1} className="lg:sticky lg:top-24 lg:self-start">
            <BookingForm
              cities={cities}
              vehicles={vehicles}
              homeCity={client.city}
              today={today()}
              discountPct={Number(tier.freight_discount_pct)}
            />
          </FadeIn>

          <div className="min-w-0 space-y-14">
            <FadeIn delay={0.15}>
              <section aria-labelledby="active-title">
                <h2 id="active-title" className="flex items-center gap-2 text-2xl font-black">
                  <Icon name="truck" size={26} className="text-midnight" />
                  Your shipments
                </h2>
                {active.length === 0 ? (
                  <p className="card-flat mt-4 font-bold text-noir/70">No shipments in progress. Book a pickup to get started.</p>
                ) : (
                  <div className="mt-6 space-y-8">
                    {active.map((s) => {
                      const job = jobs.find((j) => j.shipment_id === s.id);
                      const driver = job ? drivers.find((d) => d.id === job.driver_id) : undefined;
                      const vehicle = vehicles.find((v) => v.id === (driver?.vehicle_type ?? s.vehicle_type));
                      return <ShipmentCard key={s.id} shipment={s} job={job} driver={driver} vehicle={vehicle} tier={tier} />;
                    })}
                  </div>
                )}
              </section>
            </FadeIn>

            <FadeIn delay={0.2}>
              <NotificationFeed items={feed} role="client" />
            </FadeIn>
          </div>

          <FadeIn delay={0.25} className="lg:col-span-2 xl:col-span-1">
            <aside aria-label="Order history and trucks available" className="grid gap-6 md:grid-cols-2 xl:grid-cols-1">
              <FleetAvailability fleet={fleet} homeCity={client.city} />
              <OrderHistory shipments={settled} jobs={jobs} />
            </aside>
          </FadeIn>
        </div>

        <FadeIn delay={0.3} className="mt-16">
          <MembershipPlans tiers={tiers} current={tier.id} />
        </FadeIn>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-card p-5 sm:p-6">
      <p className="text-sm font-bold text-noir/65">{label}</p>
      <p className="mt-1 text-2xl font-black sm:text-3xl">{value}</p>
    </div>
  );
}
