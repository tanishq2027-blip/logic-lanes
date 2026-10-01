'use client';

import { changeTier } from '@/app/actions/client';
import { inr } from '@/lib/format';
import type { MembershipTier } from '@/lib/types';
import { ActionButton } from '../ActionButton';
import { Icon } from '../Icon';

export function MembershipPlans({ tiers, current }: { tiers: MembershipTier[]; current: string }) {
  const sorted = [...tiers].sort((a, b) => a.priority - b.priority);
  return (
    <section aria-labelledby="membership-title">
      <h2 id="membership-title" className="flex items-center gap-2 text-2xl font-black">
        <Icon name="star" size={26} className="text-midnight" />
        Membership
      </h2>

      <div className="mt-6 grid gap-6 md:grid-cols-3 lg:gap-8">
        {sorted.map((tier) => {
          const active = tier.id === current;
          return (
            <div
              key={tier.id}
              className={`flex flex-col rounded-card p-7 ${active ? 'bg-midnight text-pearl shadow-card-accent' : 'glass'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-black">{tier.name}</h3>
                {active ? <span className="chip border-pearl/60 bg-transparent">Your plan</span> : null}
              </div>
              <p className="mt-2 text-3xl font-black">
                {tier.monthly_price_inr === 0 ? 'Free' : inr(tier.monthly_price_inr)}
                {tier.monthly_price_inr > 0 ? <span className="text-base font-bold opacity-75"> / month</span> : null}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-[0.95rem] font-semibold">
                {tier.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <Icon name="check" size={18} className="mt-1 shrink-0" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              {active ? null : (
                <ActionButton action={changeTier.bind(null, tier.id)} className="btn-primary mt-5 w-full">
                  Switch to {tier.name}
                </ActionButton>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-sm font-bold text-noir/60">Demo: no payment is taken.</p>
    </section>
  );
}
