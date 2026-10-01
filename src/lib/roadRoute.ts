import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rows } from './data';
import { citiesAlongPath, effectivePath, pathLengthKm, pointAtProgress, projectOnPath, simplifyPath } from './geo';
import type { RoadRoute } from './ors';
import { withProgress } from './routing';
import type { City, JobCard, RouteStep, Waypoint } from './types';

/**
 * Value stored in `job_cards.route_source` once real road geometry is saved.
 * The column's check constraint dates from the first version of the app and
 * only allows 'estimate' or 'google', so 'google' is kept as the stored value;
 * it simply means "road route from the routing provider" (OpenRouteService).
 */
export const ROAD_SOURCE = 'google' as const;

/**
 * Stored polylines are capped so Job Cards stay small. 1,200 points keeps the
 * line on the road when the map is zoomed in to follow the truck.
 */
const MAX_PATH_POINTS = 1200;
const MAX_STEPS = 150;

/**
 * Replace a Job Card's estimated city-to-city route with real road geometry,
 * so the map, the client's tracking and the simulation all follow actual roads.
 * Returns false when the card changed meanwhile (for example it was rerouted).
 */
export async function applyRoadRoute(db: SupabaseClient, job: JobCard, cities: City[], route: RoadRoute): Promise<boolean> {
  const path = simplifyPath(route.path, MAX_PATH_POINTS);
  const distance_km = Math.round(route.distance_km) || Math.round(pathLengthKm(path));
  const duration_min = Math.max(1, Math.round(route.duration_min));

  // Keep the truck where it is: map its current position onto the new geometry.
  const progress = Number(job.progress);
  const here = pointAtProgress(effectivePath(job), progress);
  const newProgress = job.status === 'in_transit' && progress > 0 ? Math.min(0.999, projectOnPath(path, here).progress) : progress;

  // Itinerary: detours stay, the towns in between are re-read from the real road.
  const origin = job.waypoints[0];
  const dest = job.waypoints[job.waypoints.length - 1];
  const detours = job.waypoints.filter((w) => w.kind === 'detour');
  const named = [origin.name, dest.name, ...detours.map((d) => d.name)];
  const via = citiesAlongPath(path, cities, 18, named);
  const waypoints: Waypoint[] = withProgress([origin, ...via, ...detours, dest], path).sort((a, b) => a.at - b.at);

  // Drop the tiny manoeuvres (slip roads, roundabout exits) that would crowd out the turns that matter.
  const steps: RouteStep[] = route.steps
    .filter((s, i, all) => s.distance_km >= 0.5 || i === 0 || i === all.length - 1)
    .slice(0, MAX_STEPS)
    .map((s) => ({
      instruction: s.instruction.slice(0, 200),
      distance_km: Math.round(s.distance_km * 10) / 10,
      at: Math.round(Math.max(0, Math.min(1, s.at)) * 1e4) / 1e4,
    }));

  const remainingMin = (1 - newProgress) * duration_min;
  const updated = await rows<{ id: string }>(
    db
      .from('job_cards')
      .update({
        route_path: path,
        route_source: ROAD_SOURCE,
        waypoints,
        steps: steps.length ? steps : job.steps,
        distance_km,
        duration_min,
        progress: Math.round(newProgress * 1e5) / 1e5,
        ...(job.status === 'in_transit' ? { eta: new Date(Date.now() + remainingMin * 60_000).toISOString() } : {}),
      })
      .eq('id', job.id)
      // Only if the route has not changed since we asked for directions.
      .eq('route_version', job.route_version)
      .eq('route_source', 'estimate')
      .select('id'),
  );
  return updated.length > 0;
}
