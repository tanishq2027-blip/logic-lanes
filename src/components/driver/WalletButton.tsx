'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import { inr, kgs } from '@/lib/format';
import type { Wallet, WalletEntry } from '@/lib/types';
import { Icon } from '../Icon';

export type WalletView = Omit<Wallet, 'entries'> & { entries: (WalletEntry & { date: string })[] };

/**
 * The balance chip in the driver's header. Opens a drawer with the account
 * balance, month-to-date and all-time earnings, and the trip-by-trip history.
 *
 * Built on the native <dialog>, which brings a focus trap, Esc to close and a
 * backdrop, and sits above everything else on the page, the map included.
 */
export function WalletButton({ wallet, gig, salary, monthName }: { wallet: WalletView; gig: boolean; salary: number | null; monthName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  const show = () => {
    dialog.current?.showModal();
    setOpen(true);
  };
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="inline-flex min-h-touch items-center gap-2 rounded-full border border-noir/15 bg-white/35 px-5 py-2 font-extrabold transition-colors hover:border-midnight hover:bg-midnight hover:text-pearl"
      >
        <Icon name="wallet" size={18} />
        <span>{inr(wallet.balance_inr)}</span>
        <span className="font-bold opacity-70">{gig ? 'balance' : 'incentives'}</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="wallet-title"
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the <dialog> element itself.
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-md overflow-visible border-0 bg-transparent p-0 text-noir backdrop:bg-noir/60"
      >
        {open ? (
          <motion.div
            initial={reduce ? false : { x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex h-full flex-col border-l border-white/60 bg-pearl/75 backdrop-blur-2xl"
          >
            <header className="flex items-center justify-between gap-3 bg-midnight/75 px-6 py-5 text-pearl">
              <h2 id="wallet-title" className="flex items-center gap-2 text-2xl font-black">
                <Icon name="wallet" size={26} />
                My earnings
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close earnings"
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-pearl/60 transition-colors hover:bg-pearl hover:text-midnight"
              >
                <Icon name="x" size={22} />
              </button>
            </header>

            <div className="flex-1 space-y-8 overflow-y-auto p-6">
              <section aria-label="Balance" className="glass rounded-card p-6">
                <p className="text-sm font-extrabold uppercase tracking-wide text-noir/60">Account balance</p>
                <p className="mt-1 text-5xl font-black tabular-nums">{inr(wallet.balance_inr)}</p>
                <p className="mt-2 text-sm font-bold text-noir/65">{gig ? 'Delivered trips' : 'Trip incentives'}, not yet paid out</p>
              </section>

              <section aria-label="Totals" className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-noir/10 bg-white/30 p-5">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Earned in {monthName}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums">{inr(wallet.month_inr)}</p>
                </div>
                <div className="rounded-2xl border border-noir/10 bg-white/30 p-5">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Earned all time</p>
                  <p className="mt-1 text-2xl font-black tabular-nums">{inr(wallet.all_time_inr)}</p>
                </div>
                {salary ? (
                  <div className="col-span-2 rounded-2xl border border-noir/10 bg-white/30 p-5">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Monthly salary</p>
                    <p className="mt-1 text-2xl font-black tabular-nums">{inr(salary)}</p>
                  </div>
                ) : null}
              </section>

              <section aria-labelledby="wallet-history">
                <h3 id="wallet-history" className="text-lg font-black">
                  Transaction history
                </h3>
                {wallet.entries.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-noir/30 p-4 font-bold text-noir/70">
                    No trips delivered yet. Each delivery is credited here.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {wallet.entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 rounded-2xl border border-noir/10 bg-white/30 p-5">
                        <div className="min-w-0">
                          <p className="font-extrabold leading-snug">{e.route}</p>
                          <p className="text-sm font-bold text-noir/65">
                            {e.date} · {e.reference} · {kgs(e.weight_kg)}
                          </p>
                        </div>
                        <p className="shrink-0 text-lg font-black tabular-nums">+ {inr(e.amount_inr)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </motion.div>
        ) : null}
      </dialog>
    </>
  );
}
