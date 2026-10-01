import 'server-only';
import { cumulativeKm } from './geo';
import type { RoutingProfile } from './routing';
import type { LatLng, PathPoint } from './types';

/**
 * OpenRouteService directions (https://openrouteservice.org).
 * Fetch-only, so it runs on the Edge runtime. The API key stays on the server.
 */
export type RoadRoute = {
  /** Full road geometry as [lat, lng] pairs. */
  path: PathPoint[];
  distance_km: number;
  duration_min: number;
  /** Turn-by-turn steps. `at` is the fraction of the route (0..1) where the step starts. */
  steps: { instruction: string; distance_km: number; at: number }[];
};

export type OrsFailure = 'no_key' | 'rate_limited' | 'no_route' | 'unavailable';

const TIMEOUT_MS = 12_000;
/** How far from the given point ORS may look for a road, in metres. City-centre and bypass points are rarely on a road. */
const SNAP_RADIUS_M = 5000;

type OrsGeoJson = {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: { steps?: { distance: number; instruction: string; way_points: [number, number] }[] }[];
    };
  }[];
};

export function isOrsConfigured(): boolean {
  return Boolean(process.env.ORS_API_KEY);
}

/** Road route through the given points, in order. Never throws. */
export async function fetchRoadRoute(points: LatLng[], profile: RoutingProfile): Promise<{ route: RoadRoute } | { error: OrsFailure }> {
  const key = process.env.ORS_API_KEY;
  if (!key) return { error: 'no_key' };
  if (points.length < 2) return { error: 'no_route' };

  try {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile.ors}/geojson`, {
      method: 'POST',
      headers: {
        authorization: key,
        'content-type': 'application/json',
        accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        // ORS wants [longitude, latitude].
        coordinates: points.map((p) => [p.lng, p.lat]),
        radiuses: points.map(() => SNAP_RADIUS_M),
        instructions: true,
        instructions_format: 'text',
        language: 'en',
        units: 'm',
        preference: 'recommended',
        ...(profile.avoid.length ? { options: { avoid_features: profile.avoid } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) return { error: 'rate_limited' };
    if (res.status === 404 || res.status === 400) return { error: 'no_route' };
    if (!res.ok) return { error: 'unavailable' };

    const data = (await res.json()) as OrsGeoJson;
    const feature = data.features?.[0];
    const coords = feature?.geometry?.coordinates ?? [];
    if (coords.length < 2) return { error: 'no_route' };

    const path: PathPoint[] = coords.map(([lng, lat]) => [lat, lng]);
    const cum = cumulativeKm(path);
    const total = cum[cum.length - 1] || 1;
    const summary = feature?.properties?.summary;

    const steps = (feature?.properties?.segments ?? []).flatMap((segment) =>
      (segment.steps ?? []).map((s) => ({
        instruction: s.instruction,
        distance_km: s.distance / 1000,
        at: (cum[Math.min(s.way_points[0], cum.length - 1)] ?? 0) / total,
      })),
    );

    return {
      route: {
        path,
        distance_km: (summary?.distance ?? total * 1000) / 1000,
        duration_min: ((summary?.duration ?? 0) / 60) * profile.durationFactor,
        steps,
      },
    };
  } catch {
    return { error: 'unavailable' };
  }
}
