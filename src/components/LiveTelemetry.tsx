'use client';

import { useEffect, useState } from 'react';

/**
 * Speed readout that behaves like a live GPS feed. The server reports the
 * truck's speed every few seconds; between reports the number drifts by a
 * km/h or two around that value, the way a real speedometer reading does.
 */
export function LiveSpeed({ base, moving }: { base: number; moving: boolean }) {
  const [value, setValue] = useState(base);

  useEffect(() => {
    if (!moving || base <= 0) {
      setValue(0);
      return;
    }
    setValue(base);
    const id = setInterval(() => {
      setValue((v) => {
        // Pull gently back towards the reported speed, plus a little noise.
        const next = v + (base - v) * 0.35 + (Math.random() * 3 - 1.5);
        return Math.max(base - 4, Math.min(base + 4, next));
      });
    }, 1000);
    return () => clearInterval(id);
  }, [base, moving]);

  return (
    <span aria-live="off" className="tabular-nums">
      {Math.round(value)} km/h
    </span>
  );
}

/** "in 6 h 20 min", counting down between server updates. */
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Rendered only in the browser, so server and client clocks cannot disagree during hydration.
  if (now === null) return null;
  const min = Math.round((new Date(to).getTime() - now) / 60_000);
  if (min <= 1) return <span className="tabular-nums">arriving now</span>;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return <span className="tabular-nums">in {h > 0 ? `${h} h ` : ''}{m} min</span>;
}
