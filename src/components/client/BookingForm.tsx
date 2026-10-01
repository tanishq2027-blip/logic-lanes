'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { bookShipment, type BookingState } from '@/app/actions/client';
import { CATEGORY_LABEL, inr } from '@/lib/format';
import { rateBand } from '@/lib/pricing';
import type { City, VehicleType } from '@/lib/types';
import { describeActionFailure } from '@/lib/actionError';
import { Icon } from '../Icon';
import { pushToast } from '../Toaster';

const initial: BookingState = { ok: false, message: '' };
const DRAFT_KEY = 'fleetpulse:booking-draft';

/** Cargo booking form. Submits through the `bookShipment` Server Action, which also auto-dispatches a truck. */
export function BookingForm({
  cities,
  vehicles,
  homeCity,
  today,
  discountPct,
}: {
  cities: City[];
  vehicles: VehicleType[];
  homeCity: string;
  today: string;
  discountPct: number;
}) {
  const [state, setState] = useState<BookingState>(initial);
  const [pending, startTransition] = useTransition();
  const [weight, setWeight] = useState('');
  const [pickup, setPickup] = useState(today);
  const [restored, setRestored] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const briefed = useRef<string | null>(null);

  // Call the Server Action by hand rather than through <form action>, so the
  // fields keep what was typed when validation fails.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      let next: BookingState;
      try {
        next = await bookShipment(initial, data);
      } catch {
        // The call itself failed (the action never ran). Almost always a stale page: keep what
        // was typed, reload to the current version and put the details back.
        const failure = describeActionFailure();
        next = { ok: false, message: failure.message };
        if (failure.stale) {
          try {
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(data)));
          } catch {
            // Storage unavailable (private mode): the page still reloads, the form just starts empty.
          }
          window.location.reload();
        }
      }
      setState(next);
      pushToast({ title: next.message, alert: !next.ok });
      if (next.ok) {
        formRef.current?.reset();
        setWeight('');
        setPickup(today);
        router.refresh();
      }
    });
  }

  // Restore a booking that was interrupted by the reload above.
  useEffect(() => {
    let draft: Record<string, string> | null = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
      draft = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    } catch {
      draft = null;
    }
    const form = formRef.current;
    if (!draft || !form) return;
    for (const [name, value] of Object.entries(draft)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value;
    }
    if (draft.weight) setWeight(draft.weight);
    if (draft.pickup) setPickup(draft.pickup);
    setState({ ok: false, message: '' });
    setRestored(true);
  }, []);

  // After a successful booking, ask the Edge AI route for the transport briefing
  // in the background. The Server Action never waits on an LLM.
  useEffect(() => {
    if (!state.ok) return;
    if (state.jobCardId && briefed.current !== state.jobCardId) {
      briefed.current = state.jobCardId;
      fetch('/api/ai/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobCardId: state.jobCardId }),
      })
        .then(() => router.refresh())
        .catch(() => undefined);
    }
  }, [state, router]);

  const kg = Number(weight);
  const sorted = [...vehicles].sort((a, b) => a.capacity_kg - b.capacity_kg);
  const vehicle = kg > 0 ? sorted.find((v) => v.capacity_kg >= kg) : undefined;
  const maxKg = sorted.length ? sorted[sorted.length - 1].capacity_kg : 25000;
  const band = (v: VehicleType) => {
    const { min, max } = rateBand(v);
    return `${min}–${max}`;
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card space-y-6" aria-labelledby="booking-title">
      <div>
        <p className="eyebrow">New booking</p>
        <h2 id="booking-title" className="mt-1 text-2xl font-black">
          Book a cargo pickup
        </h2>
      </div>

      {restored && !state.message ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl border border-noir/15 bg-midnight p-4 font-bold text-pearl">
          <Icon name="refresh" size={22} className="mt-0.5 shrink-0" />
          The page was refreshed to the latest version. Your details are still here: press Book again.
        </p>
      ) : null}

      <div>
        <label htmlFor="goods" className="label">
          What are you sending?
        </label>
        <textarea
          id="goods"
          name="goods"
          required
          minLength={3}
          maxLength={300}
          rows={2}
          className="field"
          placeholder="e.g. 40 cartons of glass bottles, keep upright"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className="label">
            Goods type
          </label>
          <select id="category" name="category" className="field" defaultValue="general">
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="weight" className="label">
            Weight (kg)
          </label>
          <input
            id="weight"
            name="weight"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={maxKg}
            step={1}
            className="field"
            placeholder="e.g. 500"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            aria-describedby="vehicle-hint"
          />
        </div>
      </div>
      <p id="vehicle-hint" className="-mt-2 min-h-6 text-[0.95rem] font-bold text-midnight">
        {vehicle
          ? `Truck picked for you: ${vehicle.name} · ₹\u00A0${band(vehicle)} per km`
          : kg > maxKg
            ? 'Too heavy for one truck. Please split the load.'
            : ' '}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="origin" className="label">
            Pickup city
          </label>
          <select id="origin" name="origin" className="field" defaultValue={homeCity}>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dest" className="label">
            Drop-off city
          </label>
          <select id="dest" name="dest" className="field" defaultValue="" required>
            <option value="" disabled>
              Choose a city
            </option>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pickup" className="label">
            Pickup date
          </label>
          <input id="pickup" name="pickup" type="date" required min={today} value={pickup} onChange={(e) => setPickup(e.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor="delivery" className="label">
            Deliver by
          </label>
          <input id="delivery" name="delivery" type="date" required min={pickup || today} className="field" />
        </div>
      </div>

      <button type="submit" className="btn-primary w-full py-4 text-lg" disabled={pending} aria-busy={pending}>
        <Icon name="truck" size={24} />
        {pending ? 'Finding the best truck…' : 'Book and find a truck'}
      </button>

      <AnimatePresence mode="wait">
        {state.message ? (
          <motion.div
            key={state.message}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role={state.ok ? 'status' : 'alert'}
            className={`rounded-2xl border border-noir/10 p-5 ${state.ok ? 'bg-white/40' : 'bg-noir text-pearl'}`}
          >
            <p className="flex items-start gap-2 font-extrabold">
              <Icon name={state.ok ? 'check' : 'alert'} size={22} className="mt-0.5 shrink-0" />
              {state.message}
            </p>
            {state.ok && state.result ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.95rem]">
                <div>
                  <dt className="font-bold text-noir/60">Freight</dt>
                  <dd className="text-lg font-black">
                    {inr(state.result.price_inr)}
                    {state.result.discount_pct > 0 ? <span className="ml-1.5 text-sm font-bold text-midnight">{state.result.discount_pct}% off</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-noir/60">Truck</dt>
                  <dd className="font-extrabold">{state.result.vehicle}</dd>
                </div>
                {state.result.backhaul ? (
                  <div className="col-span-2">
                    <span className="chip-solid">
                      <Icon name="refresh" size={16} /> Return-trip match: no empty truck
                    </span>
                  </div>
                ) : null}
                {state.result.reason ? (
                  <div className="col-span-2">
                    <dt className="font-bold text-noir/60">Why this driver</dt>
                    <dd className="font-semibold">{state.result.reason}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </form>
  );
}
