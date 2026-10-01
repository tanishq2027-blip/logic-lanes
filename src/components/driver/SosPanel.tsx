'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { clearSos, triggerSos } from '@/app/actions/driver';
import { describeActionFailure } from '@/lib/actionError';
import { Icon } from '../Icon';
import { pushToast } from '../Toaster';

/** Indian emergency numbers. Tap-to-call: the app alerts people, the phone call brings help. */
const CONTACTS = [
  { number: '112', label: 'National Emergency', sub: 'Police, ambulance, fire' },
  { number: '1033', label: 'NHAI Highway Helpline', sub: 'Breakdown or accident on a national highway' },
  { number: '108', label: 'Ambulance', sub: 'Medical emergency' },
];

/**
 * Emergency / SOS section of the running Job Card.
 *
 * Pressing TRIGGER SOS never sends anything by itself: it opens a confirmation
 * dialog, so a stray touch while driving cannot raise an alarm. Confirming
 * alerts the client and the control room inside the app. It does not contact
 * the emergency services, and the dialog says so; the call buttons do that.
 */
export function SosPanel({ jobId, reference, active, since }: { jobId: string; reference: string; active: boolean; since: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Covers the moment before the page refreshes, and the case where the alert went out but could not be stored.
  const [sentHere, setSentHere] = useState(false);
  const live = active || sentHere;

  // The link itself opens the phone's dialler. On a computer nothing can place the call, so the tap
  // would otherwise look dead: confirm what was pressed and put the number on the clipboard.
  const dial = (number: string, label: string) => {
    navigator.clipboard?.writeText(number).catch(() => undefined);
    pushToast({ title: `Dial ${number} for ${label}`, body: 'On a phone the dialler opens. On a computer the number has been copied.', alert: true });
  };

  const ask = () => {
    dialog.current?.showModal();
    setOpen(true);
  };
  const cancel = () => dialog.current?.close();

  const run = (work: () => Promise<{ ok: boolean; message: string; recorded?: boolean }>, after: (ok: boolean) => void) =>
    startTransition(async () => {
      let result;
      try {
        result = await work();
      } catch {
        const failure = describeActionFailure();
        pushToast({ title: `${failure.message} If this is an emergency, call 112 now.`, alert: true });
        if (failure.stale) window.setTimeout(() => window.location.reload(), 1500);
        return;
      }
      pushToast({ title: result.message, alert: true });
      after(result.ok);
      router.refresh();
    });

  const confirm = () =>
    run(
      () => triggerSos(jobId),
      (ok) => {
        if (ok) setSentHere(true);
        cancel();
      },
    );
  const safe = () =>
    run(
      () => clearSos(jobId),
      (ok) => {
        if (ok) setSentHere(false);
      },
    );

  return (
    <section
      aria-labelledby={`sos-title-${jobId}`}
      className={`rounded-2xl border-2 p-5 ${live ? 'border-sos bg-sos/10' : 'border-sos/40 bg-white/30'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`sos-title-${jobId}`} className="flex items-center gap-2 text-lg font-black uppercase tracking-wide text-sos">
          <Icon name="alert" size={22} />
          Emergency / SOS
        </h3>
        {live ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-sos px-3.5 py-1.5 text-sm font-extrabold text-white" role="status">
            <span className="h-2.5 w-2.5 rounded-full bg-white motion-safe:animate-ping" aria-hidden="true" />
            SOS active{since ? ` since ${since}` : ''}
          </span>
        ) : null}
      </div>

      {live ? (
        <p className="mt-3 font-bold leading-snug">
          The client and the control room have been alerted. They cannot send help themselves: call 112 now if you need police or an ambulance.
        </p>
      ) : null}

      {/* Emergency numbers: large tap-to-call targets. */}
      <ul className="mt-4 grid grid-cols-3 gap-2.5">
        {CONTACTS.map((c) => (
          // `flex` on the item + `flex-1` on the link: all three are the same height whatever their labels wrap to.
          <li key={c.number} className="flex">
            <a
              href={`tel:${c.number}`}
              onClick={() => dial(c.number, c.label)}
              aria-label={`Call ${c.label}, ${c.number.split('').join(' ')}`}
              title={c.sub}
              className="flex min-h-[88px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-sos/45 bg-white/50 px-2 py-3 text-center transition-colors hover:border-sos hover:bg-sos hover:text-white active:bg-noir active:text-white"
            >
              <span className="flex items-center gap-1.5 text-2xl font-black leading-none tabular-nums">
                <Icon name="phone" size={18} />
                {c.number}
              </span>
              <span className="text-xs font-extrabold leading-tight sm:text-sm">{c.label}</span>
            </a>
          </li>
        ))}
      </ul>

      {live ? (
        <button type="button" onClick={safe} disabled={pending} aria-busy={pending} className="btn-secondary mt-4 w-full">
          <Icon name="check" size={20} />
          {pending ? 'Please wait…' : 'I am safe now: clear the SOS'}
        </button>
      ) : (
        <button
          type="button"
          onClick={ask}
          aria-haspopup="dialog"
          className="mt-4 inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-sos px-6 py-4 text-lg font-black uppercase tracking-wide text-white shadow-card-accent transition-colors hover:bg-noir"
        >
          <Icon name="alert" size={24} />
          Trigger SOS
        </button>
      )}

      {/* Confirmation. Native <dialog>: focus stays inside it, Esc cancels, and it sits above the map. */}
      <dialog
        ref={dialog}
        aria-labelledby={`sos-confirm-${jobId}`}
        aria-describedby={`sos-confirm-text-${jobId}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current && !pending) cancel();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md overflow-visible border-0 bg-transparent p-0 text-noir backdrop:bg-noir/55 backdrop:backdrop-blur-sm"
      >
        {open ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass rounded-card border-2 border-sos/50 bg-white/75 p-7"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sos text-white">
              <Icon name="alert" size={30} />
            </span>
            <h4 id={`sos-confirm-${jobId}`} className="mt-5 text-2xl font-black leading-tight">
              Trigger an emergency alert?
            </h4>
            <p id={`sos-confirm-text-${jobId}`} className="mt-3 text-lg font-semibold leading-snug text-noir/85">
              Are you sure you want to trigger an emergency alert? This will notify the client and the Logic Lanes control room for {reference}.
            </p>
            <p className="mt-3 rounded-2xl bg-sos/10 p-4 font-bold leading-snug text-sos">
              It does not call the police or an ambulance. For those, call 112 yourself.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {/* Cancel comes first and takes focus, so a second accidental tap or Enter cancels rather than confirms. */}
              <button type="button" onClick={cancel} disabled={pending} autoFocus className="btn-secondary py-4 text-lg">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                aria-busy={pending}
                className="inline-flex min-h-touch items-center justify-center gap-2 rounded-2xl bg-sos px-6 py-4 text-lg font-extrabold text-white transition-colors hover:bg-noir disabled:opacity-60"
              >
                {pending ? 'Sending…' : 'Confirm Emergency'}
              </button>
            </div>
          </motion.div>
        ) : null}
      </dialog>
    </section>
  );
}
