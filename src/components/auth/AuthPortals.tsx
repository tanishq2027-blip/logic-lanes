'use client';

import { useState, type ReactNode } from 'react';
import type { PortalRole } from '@/lib/supabase/cookies';
import { Icon } from '../Icon';

/**
 * The split entry: Ship Cargo on one side, Fleet Partner on the other.
 * Wide screens show both cards side by side. Phones show one at a time, with a
 * large two-way switch above it, so nobody has to scroll past a form that is
 * not theirs.
 */
export function AuthPortals({ initial, client, driver }: { initial: PortalRole; client: ReactNode; driver: ReactNode }) {
  const [active, setActive] = useState<PortalRole>(initial);
  const options: { role: PortalRole; label: string; icon: 'box' | 'truck' }[] = [
    { role: 'client', label: 'Ship Cargo', icon: 'box' },
    { role: 'driver', label: 'Fleet Partner', icon: 'truck' },
  ];
  return (
    <div id="portals">
      <div className="glass mb-6 grid grid-cols-2 gap-1 rounded-2xl p-1.5 lg:hidden" role="group" aria-label="Choose your portal">
        {options.map((o) => (
          <button
            key={o.role}
            type="button"
            aria-pressed={active === o.role}
            onClick={() => setActive(o.role)}
            className={`flex min-h-touch items-center justify-center gap-2 rounded-xl px-3 py-3 text-lg font-extrabold transition-colors ${
              active === o.role ? 'bg-midnight text-pearl' : 'text-noir'
            }`}
          >
            <Icon name={o.icon} size={22} />
            {o.label}
          </button>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start xl:gap-10">
        <div className={active === 'client' ? '' : 'hidden lg:block'}>{client}</div>
        <div className={active === 'driver' ? '' : 'hidden lg:block'}>{driver}</div>
      </div>
    </div>
  );
}
