'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { acceptReturnLoad } from '@/app/actions/driver';
import { inr, kgs } from '@/lib/format';
import type { ReturnLoad } from '@/lib/types';
import { ActionButton } from '../ActionButton';
import { Icon } from '../Icon';

/** Pops up over the map as the truck nears its destination, offering a load for the way back. */
export function ReturnLoadPrompt({ load, city, gig }: { load: ReturnLoad; city: string; gig: boolean }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = dismissed !== load.shipment.id;
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key={load.shipment.id}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          role="dialog"
          aria-label="Return-trip load suggestion"
          className="glass pointer-events-auto w-full max-w-xl rounded-card bg-white/55 p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-midnight">
              <Icon name="refresh" size={18} />
              Do not drive back empty from {city}
            </p>
            <button
              type="button"
              aria-label="Hide this suggestion"
              onClick={() => setDismissed(load.shipment.id)}
              className="-m-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
            >
              <Icon name="x" size={20} />
            </button>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xl font-black leading-tight">
            {load.shipment.origin_city}
            <Icon name="arrow" size={20} className="text-midnight" />
            {load.shipment.dest_city}
            {load.towards_home ? <span className="chip-solid text-xs">Towards home</span> : null}
          </p>
          <p className="mt-1 font-semibold text-noir/75">
            {kgs(load.shipment.weight_kg)} · {load.client_name} · {gig ? 'You earn' : 'Trip incentive'} {inr(load.earnings_inr)}
          </p>
          <div className="mt-3">
            <ActionButton action={acceptReturnLoad.bind(null, load.shipment.id)} className="btn-primary w-full">
              <Icon name="check" size={20} />
              Take this return load
            </ActionButton>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
