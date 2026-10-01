'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export type Toast = { title: string; body?: string; alert?: boolean };
type Shown = Toast & { id: number };

const EVENT = 'fleetpulse:toast';

/** Show a toast from any client component. */
export function pushToast(toast: Toast) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: toast }));
}

let nextId = 1;

export function Toaster() {
  const [toasts, setToasts] = useState<Shown[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const id = nextId++;
      const toast = { ...(e as CustomEvent<Toast>).detail, id };
      setToasts((list) => [...list.slice(-3), toast]);
      window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), toast.alert ? 12_000 : 6_000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex flex-col items-center gap-3 px-4 sm:items-end sm:px-6" aria-live="polite" role="status">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.25 }}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card p-4 ${
              t.alert ? 'border border-noir bg-noir text-pearl shadow-card-accent' : 'glass bg-white/60 text-noir'
            }`}
          >
            <Icon name={t.alert ? 'alert' : 'bell'} size={24} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold leading-snug">{t.title}</p>
              {t.body ? <p className={`mt-1 text-sm font-medium ${t.alert ? 'text-pearl/85' : 'text-noir/75'}`}>{t.body}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="-m-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
            >
              <Icon name="x" size={20} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
