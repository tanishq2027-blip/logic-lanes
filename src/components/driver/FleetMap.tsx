'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { effectivePath, pointAtProgress } from '@/lib/geo';
import type { Incident, JobCard } from '@/lib/types';
import { RouteMap } from '../map/RouteMap';
import { WeatherWidget } from './WeatherWidget';

type Props = {
  job: JobCard;
  incidents: Incident[];
  nearName: string;
  destName: string;
  /** Floating content anchored to the bottom of the map (return-trip prompt). */
  children?: ReactNode;
};

/** The driver's map: the live route map with the weather box and the return-trip prompt floating over it. */
export function FleetMap({ job, incidents, nearName, destName, children }: Props) {
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const here = useMemo(() => pointAtProgress(effectivePath(job), Number(job.progress)), [job]);
  const end = job.waypoints[job.waypoints.length - 1];
  const incidentPoints = useMemo(() => incidents.map((i) => ({ lat: i.lat, lng: i.lng })), [incidents]);

  return (
    <RouteMap
      job={job}
      incidents={incidentPoints}
      label={`Map of the route to ${destName}`}
      truckTitle="Your truck"
      className="h-full min-h-[420px] w-full"
      onRouteNote={setRouteNote}
    >
      {/* Overlays sit above Leaflet's own panes, which go up to z-index 1000.
          Left column, so the zoom buttons keep the top-right corner to themselves. */}
      <div className="pointer-events-none absolute left-3 top-3 z-[1100] flex flex-col items-start gap-2">
        <WeatherWidget
          here={{ ...here, place: nearName }}
          destination={end && nearName !== destName ? { lat: end.lat, lng: end.lng, place: destName } : null}
        />
        {routeNote ? (
          <span className="glass pointer-events-auto max-w-[12rem] rounded-2xl bg-white/50 px-3 py-2 text-sm font-bold leading-snug">
            {routeNote}
          </span>
        ) : null}
      </div>

      {children ? <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[1100] flex justify-center">{children}</div> : null}
    </RouteMap>
  );
}
