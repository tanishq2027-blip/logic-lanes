import {
  ROAD_FACTOR,
  bearingDeg,
  citiesAlongPath,
  compass,
  effectivePath,
  haversineKm,
  nearestCity,
  offsetPoint,
  pathLengthKm,
  pathUntil,
  pointAtProgress,
  projectOnPath,
  toPoint,
} from './geo';
import type { City, JobCard, LatLng, PathPoint, RouteStep, VehicleType, Waypoint } from './types';

/**
 * How a vehicle class should be routed. Heavy vehicles use OpenRouteService's
 * heavy-goods-vehicle profile, which keeps them off roads that are closed or
 * unsuitable for trucks; lighter vehicles use the car profile.
 */
export type RoutingProfile = {
  /** OpenRouteService routing profile. */
  ors: 'driving-hgv' | 'driving-car';
  avoid: ('ferries' | 'tollways')[];
  /** How far either side of the straight line the city-to-city estimate looks for towns. */
  corridorKm: number;
  /** ORS car-profile times are for cars; a loaded light truck is a little slower. */
  durationFactor: number;
  label: string;
};

export function routingProfile(vehicle: Pick<VehicleType, 'avoid_narrow_roads' | 'capacity_kg'>): RoutingProfile {
  if (vehicle.avoid_narrow_roads) {
    return {
      ors: 'driving-hgv',
      avoid: ['ferries'],
      corridorKm: 60,
      durationFactor: 1,
      label: 'Truck routing: highway corridor, roads unsuitable for heavy vehicles avoided',
    };
  }
  const mini = vehicle.capacity_kg <= 1000;
  return {
    ors: 'driving-car',
    avoid: mini ? ['tollways'] : [],
    corridorKm: 35,
    durationFactor: 1.15,
    label: mini ? 'Fastest route, toll roads avoided' : 'Fastest route, city roads allowed',
  };
}

export type RoutePlan = {
  waypoints: Waypoint[];
  route_path: PathPoint[];
  steps: RouteStep[];
  distance_km: number;
  duration_min: number;
};

/** Itinerary legs between waypoints, used until real turn-by-turn steps are stored. */
export function legSteps(waypoints: Waypoint[], distanceKm: number): RouteStep[] {
  const steps: RouteStep[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const km = Math.max(1, Math.round((to.at - from.at) * distanceKm));
    const dir = compass(bearingDeg(from, to));
    let instruction: string;
    if (to.kind === 'detour') instruction = `Leave the main route and take the detour ${dir} via ${to.name}`;
    else if (from.kind === 'detour') instruction = `Rejoin the main route and continue ${dir} towards ${to.name}`;
    else if (i === 1) instruction = `Leave ${from.name} heading ${dir} towards ${to.name}`;
    else if (to.kind === 'destination') instruction = `Continue ${dir} into ${to.name} for unloading`;
    else instruction = `Continue ${dir} towards ${to.name}`;
    steps.push({ instruction, distance_km: km, at: from.at });
  }
  return steps;
}

/** Route estimate from the cities table. Replaced by real road geometry once OpenRouteService responds. */
export function buildEstimatedRoute(origin: City, dest: City, cities: City[], vehicle: VehicleType): RoutePlan {
  const profile = routingProfile(vehicle);
  const direct: PathPoint[] = [toPoint(origin), toPoint(dest)];
  const via = citiesAlongPath(direct, cities, profile.corridorKm, [origin.name, dest.name]);
  const raw: Waypoint[] = [
    { name: origin.name, lat: origin.lat, lng: origin.lng, kind: 'origin', at: 0 },
    ...via,
    { name: dest.name, lat: dest.lat, lng: dest.lng, kind: 'destination', at: 1 },
  ];
  const route_path = raw.map((w) => toPoint(w));
  const waypoints = withProgress(raw, route_path);
  const distance_km = Math.round(pathLengthKm(route_path) * ROAD_FACTOR);
  return {
    waypoints,
    route_path,
    steps: legSteps(waypoints, distance_km),
    distance_km,
    duration_min: Math.round((distance_km / vehicle.avg_speed_kmph) * 60),
  };
}

/** Recompute each waypoint's `at` fraction against a path. */
export function withProgress(waypoints: Waypoint[], path: PathPoint[]): Waypoint[] {
  return waypoints.map((w) => {
    if (w.kind === 'origin') return { ...w, at: 0 };
    if (w.kind === 'destination') return { ...w, at: 1 };
    return { ...w, at: Math.round(projectOnPath(path, w).progress * 1e4) / 1e4 };
  });
}

export type ReroutePlan = RoutePlan & {
  progress: number;
  incident: LatLng;
  incident_near: string;
  detour_name: string;
  added_km: number;
};

/**
 * Deterministic reroute: place the incident ahead of the truck, leave the
 * route before it, pass through a detour point off to one side and rejoin
 * beyond it. Works with no external API, so a reroute can never fail.
 */
export function planReroute(job: JobCard, cities: City[], vehicle: VehicleType): ReroutePlan {
  const path = effectivePath(job);
  const totalKm = Number(job.distance_km) || pathLengthKm(path) * ROAD_FACTOR;
  const progress = Number(job.progress);
  const remaining = 1 - progress;

  // Incident roughly 60 km ahead, but never beyond the middle of what is left.
  const ahead = Math.min(60 / totalKm, remaining / 2);
  const pIncident = progress + ahead;
  const pRejoin = Math.min(1, pIncident + Math.min(70 / totalKm, (1 - pIncident) * 0.8));
  const incident = pointAtProgress(path, pIncident);

  const before = pointAtProgress(path, Math.max(0, pIncident - 0.01));
  const after = pointAtProgress(path, Math.min(1, pIncident + 0.01));
  const heading = bearingDeg(before, after);
  const offsetKm = Math.max(25, Math.min(50, (pRejoin - progress) * totalKm * 0.35));

  const nearIncident = nearestCity(incident, cities);
  const incident_near = nearIncident ? nearIncident.city.name : 'the highway';

  // Try both sides of the road; prefer a side with a known city to route through.
  // The town the incident is in, and towns already on the route, are not detours.
  const used = new Set([...job.waypoints.map((w) => w.name), incident_near]);
  const sides = job.route_version % 2 === 1 ? [90, -90] : [-90, 90];
  let detour: Waypoint | null = null;
  for (const side of sides) {
    const candidate = offsetPoint(incident, heading + side, offsetKm);
    const near = nearestCity(
      candidate,
      cities.filter((c) => !used.has(c.name)),
    );
    if (near && near.distanceKm <= 45 && haversineKm(near.city, incident) >= 30) {
      detour = { name: near.city.name, lat: near.city.lat, lng: near.city.lng, kind: 'detour', at: 0 };
      break;
    }
  }
  if (!detour) {
    const p = offsetPoint(incident, heading + sides[0], offsetKm);
    detour = { name: `${incident_near} bypass`, lat: p.lat, lng: p.lng, kind: 'detour', at: 0 };
  }

  // Travelled part + detour + the old route from the rejoin point onwards.
  const travelled = pathUntil(path, progress);
  const cum = cumulativeFractions(path);
  const tail: PathPoint[] = [toPoint(pointAtProgress(path, pRejoin))];
  for (let i = 0; i < path.length; i++) if (cum[i] > pRejoin) tail.push(path[i]);
  const last = path[path.length - 1];
  if (tail[tail.length - 1][0] !== last[0] || tail[tail.length - 1][1] !== last[1]) tail.push(last);
  const route_path: PathPoint[] = [...travelled, toPoint(detour), ...tail];

  const kept = job.waypoints.filter(
    (w) => w.kind === 'origin' || w.kind === 'destination' || w.at <= progress || w.at >= pRejoin,
  );
  const insertAt = kept.findIndex((w) => w.kind === 'destination' || w.at >= pRejoin);
  const merged = [...kept.slice(0, insertAt), detour, ...kept.slice(insertAt)];
  const waypoints = withProgress(merged, route_path).sort((a, b) => a.at - b.at);

  const oldLen = pathLengthKm(path) || 1;
  const newLen = pathLengthKm(route_path);
  const distance_km = Math.round(totalKm * (newLen / oldLen));
  const newProgress = Math.min(0.999, pathLengthKm(travelled) / newLen);

  return {
    waypoints,
    route_path,
    steps: legSteps(waypoints, distance_km),
    distance_km,
    duration_min: Math.round((distance_km / vehicle.avg_speed_kmph) * 60),
    progress: Math.round(newProgress * 1e5) / 1e5,
    incident,
    incident_near,
    detour_name: detour.name,
    added_km: Math.max(1, distance_km - Math.round(totalKm)),
  };
}

function cumulativeFractions(path: PathPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1] + haversineKm({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] }));
  }
  const total = out[out.length - 1] || 1;
  return out.map((v) => v / total);
}
