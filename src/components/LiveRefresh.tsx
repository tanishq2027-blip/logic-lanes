'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';

const TICK_MS = 5000;

/**
 * Keeps a server-rendered dashboard live.
 *
 * - Supabase Realtime: listens for pings on `live_events` for this viewer's
 *   topic and re-fetches the Server Components the moment one arrives.
 * - Fallback polling: if Realtime is off for this tier or cannot connect, the
 *   page re-fetches every `intervalSec` seconds instead.
 * - Telemetry tick: nudges the Edge simulation so trucks keep moving while a
 *   dashboard is open.
 */
export function LiveRefresh({
  topic,
  realtime,
  intervalSec,
  tick = true,
}: {
  topic: string;
  realtime: boolean;
  intervalSec: number;
  tick?: boolean;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  liveRef.current = live;

  useEffect(() => {
    if (!realtime) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let burst: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`live-${topic}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_events', filter: `topic=eq.${topic}` }, () => {
        // One change usually writes several pings; collapse them into one refresh.
        if (burst) return;
        burst = setTimeout(() => {
          burst = null;
          router.refresh();
        }, 350);
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      if (burst) clearTimeout(burst);
      void supabase.removeChannel(channel);
    };
  }, [topic, realtime, router]);

  useEffect(() => {
    if (!tick) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      fetch('/api/sim/tick', { method: 'POST' }).catch(() => undefined);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [tick]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || liveRef.current) return;
      router.refresh();
    }, Math.max(3, intervalSec) * 1000);
    return () => clearInterval(id);
  }, [intervalSec, router]);

  return (
    <span className="chip" title={live ? 'Connected to Supabase Realtime' : 'Refreshing on a timer'}>
      <span className={`h-2.5 w-2.5 rounded-full ${live ? 'animate-pulse bg-midnight' : 'border-2 border-noir/50'}`} aria-hidden="true" />
      {live ? 'Live' : `Updates every ${Math.max(3, intervalSec)} s`}
    </span>
  );
}
