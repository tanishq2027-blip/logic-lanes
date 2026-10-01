'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { resolveSos, restartTrip, setSimSpeed } from '@/app/actions/admin';
import type { AiAttempt, ProviderName } from '@/lib/ai/failover';
import { dateTime, km, providerName } from '@/lib/format';
import type { IncidentType, LatLng, PathPoint, Waypoint } from '@/lib/types';
import { ActionButton } from '../ActionButton';
import { Icon, type IconName } from '../Icon';
import { ProgressBar } from '../Motion';
import { SketchMap } from '../SketchMap';
import { pushToast } from '../Toaster';

export type ConsoleRoute = {
  jobId: string;
  reference: string;
  lane: string;
  driver: string;
  client: string;
  status: 'in_transit' | 'delivered';
  progress: number;
  distance_km: number;
  speed_kmph: number;
  eta: string | null;
  sim_multiplier: number;
  route_version: number;
  /** When the driver raised an SOS that is still open, formatted for display; otherwise null. */
  sos: string | null;
  driverPhone: string;
  route_source: string;
  ai_provider: string;
  path: PathPoint[];
  waypoints: Waypoint[];
  incidents: LatLng[];
};

type AiOutcome = { title: string; text: string; provider: ProviderName; attempts: AiAttempt[] };

const INCIDENTS: { type: IncidentType; label: string; icon: IconName; severity: number }[] = [
  { type: 'accident', label: 'Accident', icon: 'alert', severity: 3 },
  { type: 'traffic', label: 'Heavy traffic', icon: 'clock', severity: 2 },
  { type: 'weather', label: 'Severe weather', icon: 'cloud', severity: 2 },
  { type: 'road_closure', label: 'Road closure', icon: 'x', severity: 3 },
];

const SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Pause' },
  { value: 1, label: 'Real' },
  { value: 10, label: '10x' },
  { value: 60, label: '60x' },
  { value: 300, label: '300x' },
];

/** Admin controls for one route: simulate incidents, change the demo clock, and watch the AI failover chain answer. */
export function RouteConsole({ route }: { route: ConsoleRoute }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [down, setDown] = useState<Record<'gemini' | 'groq', boolean>>({ gemini: false, groq: false });
  const [outcome, setOutcome] = useState<AiOutcome | null>(null);
  const live = route.status === 'in_transit';
  const simulateOutage = (Object.keys(down) as ('gemini' | 'groq')[]).filter((k) => down[k]);

  async function call(kind: string, url: string, body: Record<string, unknown>, title: string) {
    setBusy(kind);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobCardId: route.jobId, simulateOutage, ...body }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        advisory?: string;
        text?: string;
        provider?: ProviderName;
        attempts?: AiAttempt[];
      };
      if (!data.ok) {
        pushToast({ title: data.message ?? 'The request failed.', alert: true });
      } else {
        setOutcome({ title, text: data.advisory ?? data.text ?? '', provider: data.provider ?? 'deterministic', attempts: data.attempts ?? [] });
        pushToast({ title: `${title}: driver and client notified` });
      }
      router.refresh();
    } catch {
      pushToast({ title: 'The request failed. Check your connection.', alert: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card" aria-label={`Route ${route.reference}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold tracking-wide text-midnight">
            {route.reference} · {route.client}
          </p>
          <h3 className="text-2xl font-black leading-tight">{route.lane}</h3>
          <p className="font-bold text-noir/70">{route.driver}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={live ? 'chip-solid' : 'chip'}>{live ? 'On the road' : 'Delivered'}</span>
          {route.sos ? <span className="inline-flex items-center rounded-full bg-sos px-3.5 py-1.5 text-sm font-extrabold text-white">SOS</span> : null}
          {route.route_version > 1 ? <span className="chip-alert">Rerouted {route.route_version - 1}x</span> : null}
        </div>
      </div>

      {route.sos ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-sos bg-sos/10 p-5">
          <div>
            <p className="flex items-center gap-2 text-lg font-black uppercase tracking-wide text-sos">
              <span className="h-2.5 w-2.5 rounded-full bg-sos motion-safe:animate-ping" aria-hidden="true" />
              SOS from the driver
            </p>
            <p className="mt-1 font-bold">
              Raised {route.sos}. Truck stopped. Call {route.driver} on{' '}
              <a href={`tel:${route.driverPhone.replace(/s/g, '')}`} className="font-black underline underline-offset-4">
                {route.driverPhone}
              </a>
              .
            </p>
          </div>
          <ActionButton action={resolveSos.bind(null, route.jobId)} className="btn-alert" confirmText="Mark this SOS as resolved and let the truck continue?">
            <Icon name="check" size={20} />
            Mark resolved
          </ActionButton>
        </div>
      ) : null}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <SketchMap
            path={route.path}
            waypoints={route.waypoints}
            progress={route.progress}
            incidents={route.incidents}
            showTruck={live}
            className="h-64 w-full rounded-2xl border border-noir/15"
          />
          <div className="mt-3">
            <ProgressBar value={route.progress} label={`${route.reference} progress`} />
          </div>
          <p className="mt-2 text-sm font-bold text-noir/70">
            {Math.round(route.progress * 100)}% of {km(route.distance_km)}
            {live ? ` · ${route.speed_kmph} km/h · arriving ${route.eta ? dateTime(route.eta) : 'soon'}` : ''}
            {' · '}
            {route.route_source === 'estimate' ? 'estimated route' : 'OpenRouteService road route'}
          </p>
        </div>

        <div className="space-y-5">
          {live ? (
            <>
              <fieldset disabled={busy !== null}>
                <legend className="label">Simulate an incident ahead of the truck</legend>
                <div className="grid grid-cols-2 gap-3">
                  {INCIDENTS.map((inc) => (
                    <button
                      key={inc.type}
                      type="button"
                      className="btn-alert"
                      aria-busy={busy === inc.type}
                      onClick={() => call(inc.type, '/api/ai/reroute', { type: inc.type, severity: inc.severity }, `${inc.label} simulated`)}
                    >
                      <Icon name={inc.icon} size={20} />
                      {busy === inc.type ? 'Rerouting…' : inc.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <p className="label">Demo clock</p>
                <div className="grid grid-cols-5 gap-2">
                  {SPEEDS.map((s) => (
                    <ActionButton
                      key={s.value}
                      action={setSimSpeed.bind(null, route.jobId, s.value)}
                      className={route.sim_multiplier === s.value ? 'btn-primary px-2' : 'btn-secondary px-2'}
                    >
                      {s.label}
                    </ActionButton>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div>
            <p className="label">AI failover test</p>
            <div className="flex flex-wrap gap-2">
              {(['gemini', 'groq'] as const).map((p) => (
                <label
                  key={p}
                  className={`inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-xl border border-noir/15 px-4 py-2 font-extrabold ${
                    down[p] ? 'bg-noir text-pearl' : 'bg-white/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#122C4F]"
                    checked={down[p]}
                    onChange={(e) => setDown((d) => ({ ...d, [p]: e.target.checked }))}
                  />
                  {providerName(p)} down
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                aria-busy={busy === 'summary'}
                onClick={() => call('summary', '/api/ai/summary', {}, 'AI briefing rewritten')}
              >
                <Icon name="spark" size={20} />
                {busy === 'summary' ? 'Writing…' : 'Rewrite AI briefing'}
              </button>
              <ActionButton action={restartTrip.bind(null, route.jobId, 0.5)} className="btn-secondary">
                <Icon name="refresh" size={20} />
                Replay from 50%
              </ActionButton>
            </div>
          </div>

          {outcome ? (
            <div className="rounded-2xl border border-noir/15 p-4" role="status">
              <p className="text-sm font-extrabold uppercase tracking-wide text-midnight">{outcome.title}</p>
              <p className="mt-1.5 font-semibold leading-relaxed">{outcome.text}</p>
              <ol className="mt-3 space-y-1.5">
                {outcome.attempts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm font-bold">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-noir/15 ${a.ok ? 'bg-midnight text-pearl' : 'bg-white/40'}`}
                    >
                      <Icon name={a.ok ? 'check' : 'x'} size={12} />
                    </span>
                    <span>
                      {i + 1}. {providerName(a.provider)}
                    </span>
                    <span className="text-noir/60">{a.ok ? `answered in ${a.ms} ms` : `failed: ${a.error ?? 'error'}`}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm font-bold text-noir/60">Current briefing written by {providerName(route.ai_provider)}.</p>
          )}
        </div>
      </div>
    </article>
  );
}
