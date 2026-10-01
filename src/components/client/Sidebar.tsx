import { dateShort, inr, kgs } from '@/lib/format';
import type { FleetGroup, JobCard, Shipment } from '@/lib/types';
import { Icon } from '../Icon';

/** Past deliveries, newest first, in a list that scrolls inside its own panel. */
export function OrderHistory({ shipments, jobs }: { shipments: Shipment[]; jobs: JobCard[] }) {
  const total = shipments.reduce((sum, s) => sum + s.quoted_price_inr, 0);
  return (
    <section aria-labelledby="history-title" className="glass rounded-card p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="history-title" className="flex items-center gap-2 text-xl font-black">
          <Icon name="check" size={22} className="text-midnight" />
          Order history
        </h2>
        {shipments.length > 0 ? <span className="chip">{shipments.length}</span> : null}
      </div>

      {shipments.length === 0 ? (
        <p className="mt-3 font-semibold text-noir/70">Delivered and paid orders will be listed here.</p>
      ) : (
        <>
          {/* tabIndex makes the scrolling list reachable and scrollable from the keyboard. */}
          <ul className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" tabIndex={0} aria-label="Completed deliveries">
            {shipments.map((s) => {
              const delivered = jobs.find((j) => j.shipment_id === s.id)?.delivered_at;
              return (
                <li key={s.id} className="rounded-2xl border border-noir/10 bg-white/30 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-extrabold leading-snug">
                      {s.origin_city} to {s.dest_city}
                    </p>
                    <p className="shrink-0 font-black tabular-nums">{inr(s.quoted_price_inr)}</p>
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-noir/65">
                    {s.reference} · {kgs(s.weight_kg)} · delivered {delivered ? dateShort(delivered) : dateShort(s.delivery_date)}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-center justify-between border-t border-noir/10 pt-3 font-extrabold">
            <span>Total freight</span>
            <span className="tabular-nums">{inr(total)}</span>
          </p>
        </>
      )}
    </section>
  );
}

/** Idle trucks ready for dispatch, grouped by city. Counts only: no driver details reach the client. */
export function FleetAvailability({ fleet, homeCity }: { fleet: FleetGroup[]; homeCity: string }) {
  const total = fleet.reduce((sum, g) => sum + g.total, 0);
  return (
    <section aria-labelledby="fleet-title" className="glass rounded-card p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="fleet-title" className="flex items-center gap-2 text-xl font-black">
          <Icon name="truck" size={22} className="text-midnight" />
          Trucks available
        </h2>
        <span className="chip-solid">
          <span className="h-2 w-2 animate-pulse rounded-full bg-pearl" aria-hidden="true" />
          {total} free now
        </span>
      </div>

      {fleet.length === 0 ? (
        <p className="mt-3 font-semibold text-noir/70">
          Every truck is on a trip right now. Book anyway: your load is offered to the first truck that frees up near your pickup.
        </p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" tabIndex={0} aria-label="Idle trucks by city">
          {fleet.map((g) => (
            <li key={g.city} className={`rounded-2xl border border-noir/10 bg-white/30 p-4 ${g.city === homeCity ? 'bg-midnight text-pearl' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-extrabold">
                  <Icon name="pin" size={16} />
                  {g.city}
                </p>
                {g.city === homeCity ? <span className="chip border-pearl/60 bg-transparent px-2 py-0.5 text-xs">Your city</span> : null}
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {g.vehicles.map((v) => (
                  <li key={v.name} className={`text-[0.95rem] font-semibold ${g.city === homeCity ? 'text-pearl/90' : 'text-noir/75'}`}>
                    <span className="font-black tabular-nums">{v.count}</span> × {v.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
