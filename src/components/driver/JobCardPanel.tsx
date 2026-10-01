import { acceptReturnLoad, markDelivered, respondToOffer, startTrip } from '@/app/actions/driver';
import { CATEGORY_LABEL, JOB_STATUS, dateShort, dateTime, duration, inr, kgs, km, providerName } from '@/lib/format';
import { sosOpen, type Incident, type JobCard, type ReturnLoad, type RouteStep, type Shipment, type VehicleType } from '@/lib/types';
import type { ReactNode } from 'react';
import { ActionButton } from '../ActionButton';
import { Icon } from '../Icon';
import { LiveSpeed } from '../LiveTelemetry';
import { ProgressBar } from '../Motion';
import { BriefingButton } from './BriefingButton';
import { SosPanel } from './SosPanel';

/**
 * The digital Job Card: a Pearl card with Noir borders and text, shown beside
 * the map. Everything a driver needs for the trip, most critical first.
 */
export function JobCardPanel({
  job,
  shipment,
  clientName,
  vehicle,
  routingLabel,
  gig,
  payout,
  incident,
  returnLoads,
  tripRunning,
}: {
  job: JobCard;
  shipment: Shipment;
  clientName: string;
  vehicle: VehicleType;
  routingLabel: string;
  gig: boolean;
  payout: number;
  incident?: Incident;
  returnLoads: ReturnLoad[];
  tripRunning: boolean;
}) {
  const progress = Number(job.progress);
  const distance = Number(job.distance_km);
  const remainingKm = (1 - progress) * distance;
  const moving = job.status === 'in_transit';
  const emergency = moving && sosOpen(job);
  const turns = nextTurns(job.steps, progress, distance);
  const nextStop = job.waypoints.find((w) => w.at > progress);

  return (
    <article
      id={`job-${job.id}`}
      className={`glass scroll-mt-28 rounded-card text-noir ${emergency ? 'ring-4 ring-sos' : ''}`}
      aria-labelledby={`job-card-title-${job.id}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-noir/10 p-6 sm:p-7">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em]">Job Card · {shipment.reference}</p>
          <h2 id={`job-card-title-${job.id}`} className="mt-1 flex flex-wrap items-center gap-x-2 text-3xl font-black leading-tight">
            {shipment.origin_city}
            <Icon name="arrow" size={26} className="text-midnight" />
            {shipment.dest_city}
          </h2>
          <p className="mt-1 font-bold text-noir/70">For {clientName}</p>
        </div>
        <span className={moving ? 'chip-solid shrink-0' : 'chip shrink-0'}>{JOB_STATUS[job.status]}</span>
      </div>

      <div className="space-y-7 p-6 sm:p-7">
        {/* Reroute alert */}
        {moving && job.route_version > 1 && incident ? (
          <div className="rounded-2xl bg-noir p-4 text-pearl" role="alert">
            <p className="flex items-center gap-2 font-black uppercase tracking-wide">
              <Icon name="alert" size={22} /> Route changed
            </p>
            <p className="mt-1.5 font-semibold leading-relaxed">{incident.description}</p>
            <p className="mt-1.5 text-sm font-bold text-pearl/75">Expected delay {duration(incident.delay_min)}</p>
          </div>
        ) : null}

        {/* Goods */}
        <section aria-label="Goods">
          <p className="label">Goods</p>
          <p className="rounded-2xl border border-noir/15 p-4 text-lg font-extrabold leading-snug">{job.goods_summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip-alert text-base">{kgs(shipment.weight_kg)}</span>
            <span className="chip">{CATEGORY_LABEL[shipment.goods_category]}</span>
            <span className="chip">
              <Icon name="truck" size={16} />
              {vehicle.name}
            </span>
            {job.is_backhaul ? (
              <span className="chip-solid">
                <Icon name="refresh" size={16} />
                Return-trip load
              </span>
            ) : null}
          </div>
        </section>

        {/* Live numbers */}
        {moving ? (
          <section aria-label="Trip progress">
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
              <Figure label="Arriving" value={job.eta ? dateTime(job.eta) : '--'} className="col-span-2 sm:col-span-1" />
              <Figure label="Left to go" value={km(remainingKm)} />
              <Figure label="Speed now" value={<LiveSpeed base={job.speed_kmph} moving={job.sim_multiplier > 0} />} />
            </div>
            <div className="mt-3">
              <ProgressBar value={progress} label="Trip progress" />
            </div>
            <p className="mt-1.5 text-sm font-bold text-noir/70">
              {Math.round(progress * 100)}% done{nextStop ? ` · next: ${nextStop.name}` : ''}
            </p>
          </section>
        ) : (
          <section aria-label="Trip details" className="grid grid-cols-3 gap-3 text-center">
            <Figure label="Pickup" value={dateShort(shipment.pickup_date)} />
            <Figure label="Distance" value={km(distance)} />
            <Figure label="Driving" value={duration(job.duration_min)} />
          </section>
        )}

        {/* AI briefing */}
        <section aria-label="AI briefing" className="rounded-2xl border border-noir/15 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-midnight">
              <Icon name="spark" size={18} /> AI briefing
            </p>
            <BriefingButton jobCardId={job.id} />
          </div>
          <p className="mt-2 font-semibold leading-relaxed">{job.ai_summary ?? 'Preparing the briefing.'}</p>
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-noir/55">Written by {providerName(job.ai_provider)}</p>
        </section>

        {/* Next turns */}
        <section aria-label="Next turns">
          <p className="label">{moving ? 'Next turns' : 'Route'}</p>
          <ol className="space-y-2">
            {turns.map((t, i) => (
              <li key={`${t.at}-${i}`} className={`flex items-start gap-3 rounded-xl border border-noir/15 p-3 ${i === 0 && moving ? 'bg-midnight text-pearl' : ''}`}>
                <Icon name={i === 0 ? 'turn' : 'route'} size={22} className="mt-0.5 shrink-0" />
                <span className="flex-1 font-bold leading-snug">{t.instruction}</span>
                <span className="shrink-0 font-black">{t.km < 1 ? `${Math.round(t.km * 1000)} m` : km(t.km)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 flex items-center gap-2 text-sm font-bold text-noir/70">
            <Icon name="shield" size={16} className="shrink-0 text-midnight" />
            {routingLabel}
            {job.route_source === 'estimate' ? ' · estimated route' : ' · road route by OpenRouteService'}
          </p>
        </section>

        {/* Itinerary */}
        <section aria-label="Itinerary">
          <p className="label">Itinerary</p>
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {job.waypoints.map((w, i) => {
              const passed = moving ? w.at <= progress : false;
              return (
                <li key={`${w.name}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 ? <span className="h-0.5 w-3 bg-noir" aria-hidden="true" /> : null}
                  <span
                    className={`rounded-full border border-noir/15 px-2.5 py-1 text-sm font-extrabold ${
                      w.kind === 'detour' ? 'bg-noir text-pearl' : passed ? 'bg-midnight text-pearl' : 'bg-white/40'
                    }`}
                  >
                    {w.kind === 'detour' ? `Detour: ${w.name}` : w.name}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Why this job + pay */}
        <section className="flex flex-wrap items-center justify-between gap-3 border-t border-noir/10 pt-4">
          <div>
            <p className="text-sm font-bold text-noir/60">{gig ? 'You earn' : 'Trip incentive'}</p>
            <p className="text-2xl font-black">{inr(payout)}</p>
          </div>
        </section>

        {/* Actions */}
        {job.status === 'offered' ? (
          <div className="grid grid-cols-2 gap-3">
            <ActionButton action={respondToOffer.bind(null, job.id, true)} className="btn-primary py-4 text-lg">
              <Icon name="check" size={22} /> Accept
            </ActionButton>
            <ActionButton action={respondToOffer.bind(null, job.id, false)} className="btn-secondary py-4 text-lg">
              <Icon name="x" size={22} /> Reject
            </ActionButton>
          </div>
        ) : null}
        {job.status === 'assigned' ? (
          <ActionButton action={startTrip.bind(null, job.id)} className="btn-primary w-full py-4 text-lg" disabled={tripRunning}>
            <Icon name="truck" size={24} />
            {tripRunning ? 'Starts after your current trip' : 'Start trip'}
          </ActionButton>
        ) : null}
        {moving ? (
          <ActionButton
            action={markDelivered.bind(null, job.id)}
            className="btn-alert w-full py-4 text-lg"
            confirmText={`Confirm that ${shipment.reference} has been unloaded in ${shipment.dest_city}?`}
          >
            <Icon name="check" size={24} />
            Mark delivered
          </ActionButton>
        ) : null}

        {/* Emergency: always in the same place on a running trip, so it can be found without looking for it. */}
        {moving ? (
          <SosPanel jobId={job.id} reference={shipment.reference} active={emergency} since={emergency && job.sos_at ? dateTime(job.sos_at) : null} />
        ) : null}

        {/* Return-trip suggestions */}
        {returnLoads.length > 0 ? (
          <section aria-label="Return-trip loads" className="border-t border-noir/10 pt-4">
            <p className="label flex items-center gap-2">
              <Icon name="refresh" size={18} className="text-midnight" />
              Loads for your return trip from {shipment.dest_city}
            </p>
            <ul className="space-y-3">
              {returnLoads.map((load) => (
                <li key={load.shipment.id} className="rounded-2xl border border-noir/15 p-4">
                  <p className="flex flex-wrap items-center gap-x-2 text-lg font-black">
                    {load.shipment.origin_city}
                    <Icon name="arrow" size={18} className="text-midnight" />
                    {load.shipment.dest_city}
                    {load.towards_home ? <span className="chip-solid text-xs">Towards home</span> : null}
                  </p>
                  <p className="mt-1 text-[0.95rem] font-semibold text-noir/75">
                    {kgs(load.shipment.weight_kg)} · {load.client_name} · pickup {dateShort(load.shipment.pickup_date)}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-lg font-black">
                      {inr(load.earnings_inr)} <span className="text-sm font-bold text-noir/60">{gig ? 'for you' : 'incentive'}</span>
                    </p>
                    <ActionButton action={acceptReturnLoad.bind(null, load.shipment.id)} className="btn-primary px-4 py-2">
                      Take load
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function Figure({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-noir/15 px-2 py-3 ${className}`}>
      <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">{label}</p>
      <p className="mt-0.5 text-lg font-black leading-tight sm:text-xl">{value}</p>
    </div>
  );
}

/** The step the truck is on (with what is left of it) and the three after it. */
function nextTurns(steps: RouteStep[], progress: number, totalKm: number): { instruction: string; km: number; at: number }[] {
  if (steps.length === 0) return [];
  let current = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].at <= progress) current = i;
  return steps.slice(current, current + 4).map((s, i) => {
    if (i > 0) return { instruction: s.instruction, km: s.distance_km, at: s.at };
    const end = steps[current + 1]?.at ?? 1;
    return { instruction: s.instruction, km: Math.max(0, (end - progress) * totalKm), at: s.at };
  });
}
