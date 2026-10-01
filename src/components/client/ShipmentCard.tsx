import { CATEGORY_LABEL, SHIPMENT_STATUS, dateShort, dateTime, inr, kgs, km, providerName } from '@/lib/format';
import { sosOpen, type Driver, type JobCard, type MembershipTier, type Shipment, type VehicleType } from '@/lib/types';
import { Icon } from '../Icon';
import { ClientPaymentCard } from './ClientPaymentCard';
import { Countdown, LiveSpeed } from '../LiveTelemetry';
import { RouteMap } from '../map/RouteMap';
import { ProgressBar } from '../Motion';

/** One shipment on the client dashboard. While it is on the road it shows the live map, ETA and progress. */
export function ShipmentCard({
  shipment,
  job,
  driver,
  vehicle,
  tier,
}: {
  shipment: Shipment;
  job?: JobCard;
  driver?: Driver;
  vehicle?: VehicleType;
  tier: MembershipTier;
}) {
  const onRoad = shipment.status === 'in_transit' && job;
  const progress = job ? Number(job.progress) : 0;
  const remainingKm = job ? (1 - progress) * Number(job.distance_km) : 0;
  const rerouted = job ? job.route_version > 1 : false;
  const nextStop = job?.waypoints.find((w) => w.at > progress);

  return (
    <article id={`shipment-${shipment.id}`} className="card scroll-mt-28" aria-label={`Shipment ${shipment.reference}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold tracking-wide text-midnight">{shipment.reference}</p>
          <h3 className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xl font-black leading-tight">
            {shipment.origin_city}
            <Icon name="arrow" size={22} className="text-midnight" />
            {shipment.dest_city}
          </h3>
        </div>
        <span className={shipment.status === 'in_transit' ? 'chip-solid' : shipment.status === 'delivered' ? 'chip-alert' : 'chip'}>
          {SHIPMENT_STATUS[shipment.status]}
        </span>
      </div>

      {onRoad && sosOpen(job) ? (
        <div role="alert" className="mt-4 rounded-2xl border-2 border-sos bg-sos/10 p-5">
          <p className="flex items-center gap-2 text-lg font-black uppercase tracking-wide text-sos">
            <span className="h-2.5 w-2.5 rounded-full bg-sos motion-safe:animate-ping" aria-hidden="true" />
            Emergency reported
          </p>
          <p className="mt-2 font-bold leading-snug">
            {driver?.name ?? 'The driver'} raised an SOS{job.sos_at ? ` at ${dateTime(job.sos_at)}` : ''}. The truck is stopped and our control room has been alerted.
            {driver?.phone ? ` Driver's phone: ${driver.phone}.` : ''}
          </p>
        </div>
      ) : null}

      {/* Live tracking comes first while the truck is on the road: it is what the client opened the page for. */}
      {onRoad ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-2xl bg-midnight p-4 text-pearl">
              <p className="text-xs font-extrabold uppercase tracking-wide text-pearl/75">Estimated arrival</p>
              <p className="mt-0.5 text-2xl font-black leading-tight">{job.eta ? dateTime(job.eta) : 'Calculating'}</p>
              <p className="text-sm font-bold text-pearl/85">{job.eta ? <Countdown to={job.eta} /> : null}</p>
            </div>
            <div className="rounded-2xl border border-noir/10 bg-white/30 p-5">
              <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Left to go</p>
              <p className="mt-0.5 text-2xl font-black leading-tight">{km(remainingKm)}</p>
              <p className="text-sm font-bold text-noir/65">of {km(Number(job.distance_km))}</p>
            </div>
            <div className="rounded-2xl border border-noir/10 bg-white/30 p-5">
              <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Speed now</p>
              <p className="mt-0.5 text-2xl font-black leading-tight">
                <LiveSpeed base={job.speed_kmph} moving={job.sim_multiplier > 0} />
              </p>
              <p className="truncate text-sm font-bold text-noir/65">{nextStop ? `next: ${nextStop.name}` : 'arriving'}</p>
            </div>
          </div>

          <RouteMap
            job={job}
            label={`Live map of ${shipment.reference}, ${shipment.origin_city} to ${shipment.dest_city}`}
            truckTitle={driver ? `${driver.name}, ${driver.vehicle_number}` : 'Your shipment'}
            controls={false}
            className="mt-3 h-72 w-full sm:h-80"
          />

          <div className="mt-3">
            <ProgressBar value={progress} label={`${shipment.reference} trip progress`} />
          </div>
          <p className="mt-1.5 text-sm font-bold text-noir/70">{Math.round(progress * 100)}% of the trip done</p>
        </div>
      ) : null}

      <p className="mt-4 font-semibold text-noir/80">{shipment.goods_description}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[0.95rem] sm:grid-cols-4">
        <div>
          <dt className="font-bold text-noir/60">Load</dt>
          <dd className="font-extrabold">
            {kgs(shipment.weight_kg)} · {CATEGORY_LABEL[shipment.goods_category]}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-noir/60">Pickup</dt>
          <dd className="font-extrabold">{dateShort(shipment.pickup_date)}</dd>
        </div>
        <div>
          <dt className="font-bold text-noir/60">Deliver by</dt>
          <dd className="font-extrabold">{dateShort(shipment.delivery_date)}</dd>
        </div>
        <div>
          <dt className="font-bold text-noir/60">Freight</dt>
          <dd className="font-extrabold">
            {inr(shipment.quoted_price_inr)}
            {Number(shipment.discount_pct) > 0 ? <span className="ml-1 text-sm text-midnight">({Number(shipment.discount_pct)}% off)</span> : null}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {driver ? (
          <span className="chip">
            <Icon name="user" size={16} />
            {driver.name} · {driver.vehicle_number}
          </span>
        ) : null}
        {vehicle ? (
          <span className="chip">
            <Icon name="truck" size={16} />
            {vehicle.name}
          </span>
        ) : null}
        {shipment.is_backhaul ? (
          <span className="chip-solid">
            <Icon name="refresh" size={16} />
            Return-trip match
          </span>
        ) : null}
        {rerouted && shipment.status === 'in_transit' ? (
          <span className="chip-alert">
            <Icon name="route" size={16} />
            Rerouted
          </span>
        ) : null}
      </div>

      {onRoad ? (
        tier.ai_tracking ? (
          <div className="mt-4 rounded-2xl border border-noir/10 bg-white/30 p-5">
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-midnight">
              <Icon name="spark" size={18} /> AI briefing
            </p>
            <p className="mt-2 font-semibold leading-relaxed">{job.ai_summary ?? 'Preparing the briefing.'}</p>
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-noir/55">Written by {providerName(job.ai_provider)}</p>
          </div>
        ) : null
      ) : null}

      {shipment.status === 'pending' ? (
        <p className="mt-4 font-bold text-noir/75">
          Looking for a truck near {shipment.origin_city}.
        </p>
      ) : null}
      {shipment.status === 'assigned' && job ? (
        <p className="mt-4 font-bold text-noir/75">
          {driver?.name ?? 'Your driver'} is confirmed. Live tracking starts at pickup.
        </p>
      ) : null}

      {/* Payment: a trip brief from the moment a driver is confirmed; the UPI QR only once delivered. */}
      {shipment.status === 'assigned' || shipment.status === 'in_transit' || shipment.status === 'delivered' ? (
        <ClientPaymentCard
          shipmentId={shipment.id}
          reference={shipment.reference}
          status={shipment.status}
          distanceKm={Number(job?.distance_km ?? shipment.distance_km)}
          cargoType={CATEGORY_LABEL[shipment.goods_category]}
          priceInr={shipment.quoted_price_inr}
          paidOn={shipment.paid_at ? dateTime(shipment.paid_at) : null}
          upiId={process.env.UPI_ID?.trim() || null}
        />
      ) : null}
    </article>
  );
}
