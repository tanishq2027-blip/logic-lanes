import { acceptOpenLoad, declineOpenLoad } from '@/app/actions/driver';
import { CATEGORY_LABEL, dateShort, inr, kgs, km } from '@/lib/format';
import type { ReturnLoad } from '@/lib/types';
import { ActionButton } from '../ActionButton';
import { Icon } from '../Icon';

/**
 * An incoming order an available driver can take: where from, where to, what
 * it is, what it pays, and two unmistakable buttons.
 */
export function OpenLoadCard({ load, gig }: { load: ReturnLoad; gig: boolean }) {
  const s = load.shipment;
  const pickupKm = load.pickup_km ?? 0;
  return (
    <article className="glass flex h-full flex-col rounded-card p-6 sm:p-7" aria-label={`Load ${s.reference}, ${s.origin_city} to ${s.dest_city}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase tracking-[0.18em]">New order · {s.reference}</p>
        <div className="flex flex-wrap gap-2">
          <span className="chip">
            <Icon name="pin" size={16} />
            {pickupKm === 0 ? 'Pickup in your city' : `${km(pickupKm)} to pickup`}
          </span>
          {load.towards_home ? (
            <span className="chip-solid">
              <Icon name="refresh" size={16} />
              Towards home
            </span>
          ) : null}
        </div>
      </div>

      <h3 className="mt-3 flex flex-wrap items-center gap-x-2 text-2xl font-black leading-tight">
        {s.origin_city}
        <Icon name="arrow" size={24} className="text-midnight" />
        {s.dest_city}
      </h3>
      <p className="mt-1 font-bold text-noir/70">For {load.client_name}</p>

      <p className="mt-3 rounded-2xl border border-noir/15 p-3 font-extrabold leading-snug">{s.goods_description}</p>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-noir/15 px-2 py-2.5">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Load</dt>
          <dd className="mt-0.5 font-black leading-tight">{kgs(s.weight_kg)}</dd>
          <dd className="text-xs font-bold text-noir/65">{CATEGORY_LABEL[s.goods_category]}</dd>
        </div>
        <div className="rounded-xl border border-noir/15 px-2 py-2.5">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Pickup</dt>
          <dd className="mt-0.5 font-black leading-tight">{dateShort(s.pickup_date)}</dd>
          <dd className="text-xs font-bold text-noir/65">by {dateShort(s.delivery_date)}</dd>
        </div>
        <div className="rounded-xl border border-noir/15 px-2 py-2.5">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Trip</dt>
          <dd className="mt-0.5 font-black leading-tight">{km(Number(s.distance_km))}</dd>
          <dd className="text-xs font-bold text-noir/65">one way</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-noir/10 pt-4">
        <div>
          <p className="text-sm font-bold text-noir/60">{gig ? 'You earn' : 'Trip incentive'}</p>
          <p className="text-3xl font-black">{inr(load.earnings_inr)}</p>
        </div>
        <p className="text-right text-sm font-bold text-noir/65">Freight {inr(s.quoted_price_inr)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ActionButton action={acceptOpenLoad.bind(null, s.id)} className="btn-primary py-4 text-lg" ariaLabel={`Accept ${s.reference}`}>
          <Icon name="check" size={22} /> Accept
        </ActionButton>
        <ActionButton action={declineOpenLoad.bind(null, s.id)} className="btn-secondary py-4 text-lg" ariaLabel={`Reject ${s.reference}`}>
          <Icon name="x" size={22} /> Reject
        </ActionButton>
      </div>
    </article>
  );
}
