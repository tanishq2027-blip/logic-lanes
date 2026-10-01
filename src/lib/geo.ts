import type { City, LatLng, PathPoint, Waypoint } from './types';

/** Straight-line distances are scaled by this to approximate Indian highway distances. */
export const ROAD_FACTOR = 1.16;

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const toLatLng = (p: PathPoint): LatLng => ({ lat: p[0], lng: p[1] });
export const toPoint = (p: LatLng): PathPoint => [round5(p.lat), round5(p.lng)];
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Cumulative straight-line length (km) at every vertex of the path. */
export function cumulativeKm(path: PathPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1] + haversineKm(toLatLng(path[i - 1]), toLatLng(path[i])));
  }
  return out;
}

export function pathLengthKm(path: PathPoint[]): number {
  const c = cumulativeKm(path);
  return c[c.length - 1] ?? 0;
}

/** Position at a fraction (0..1) of the path's length. */
export function pointAtProgress(path: PathPoint[], progress: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return toLatLng(path[0]);
  const cum = cumulativeKm(path);
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < path.length; i++) {
    if (cum[i] >= target) {
      const seg = cum[i] - cum[i - 1];
      const t = seg === 0 ? 0 : (target - cum[i - 1]) / seg;
      return {
        lat: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        lng: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      };
    }
  }
  return toLatLng(path[path.length - 1]);
}

/** Vertices of the path up to `progress`, ending exactly at the interpolated point. */
export function pathUntil(path: PathPoint[], progress: number): PathPoint[] {
  if (path.length < 2) return path.slice();
  const cum = cumulativeKm(path);
  const target = Math.max(0, Math.min(1, progress)) * cum[cum.length - 1];
  const out: PathPoint[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (cum[i] < target) out.push(path[i]);
    else break;
  }
  out.push(toPoint(pointAtProgress(path, progress)));
  return out;
}

/** Closest position on the path to `point`: fraction along it and distance from it. */
export function projectOnPath(path: PathPoint[], point: LatLng): { progress: number; distanceKm: number } {
  if (path.length < 2) return { progress: 0, distanceKm: path.length ? haversineKm(toLatLng(path[0]), point) : 0 };
  const cum = cumulativeKm(path);
  const total = cum[cum.length - 1] || 1;
  const kx = Math.cos(rad(point.lat));
  let best = { progress: 0, distanceKm: Infinity };
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][1] * kx;
    const ay = path[i - 1][0];
    const bx = path[i][1] * kx;
    const by = path[i][0];
    const px = point.lng * kx;
    const py = point.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const proj = { lat: ay + dy * t, lng: (ax + dx * t) / kx };
    const d = haversineKm(proj, point);
    if (d < best.distanceKm) {
      best = { progress: (cum[i - 1] + (cum[i] - cum[i - 1]) * t) / total, distanceKm: d };
    }
  }
  return best;
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function offsetPoint(p: LatLng, bearing: number, km: number): LatLng {
  const d = km / R;
  const b = rad(bearing);
  const lat1 = rad(p.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    rad(p.lng) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}

export function compass(bearing: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(bearing / 45) % 8];
}

export function nearestCity(point: LatLng, cities: City[]): { city: City; distanceKm: number } | null {
  let best: { city: City; distanceKm: number } | null = null;
  for (const city of cities) {
    const d = haversineKm(point, city);
    if (!best || d < best.distanceKm) best = { city, distanceKm: d };
  }
  return best;
}

/** Keep at most `max` points, always including the first and last. */
export function simplifyPath(path: PathPoint[], max: number): PathPoint[] {
  if (path.length <= max) return path;
  const out: PathPoint[] = [];
  const step = (path.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(path[Math.round(i * step)]);
  return out;
}

/**
 * Cities that sit along a path, in travel order, with the fraction at which
 * the route passes them. Used to build the itinerary shown on the Job Card.
 */
export function citiesAlongPath(
  path: PathPoint[],
  cities: City[],
  corridorKm: number,
  exclude: string[] = [],
): Waypoint[] {
  const found: Waypoint[] = [];
  for (const city of cities) {
    if (exclude.includes(city.name)) continue;
    const { progress, distanceKm } = projectOnPath(path, city);
    if (distanceKm <= corridorKm && progress > 0.02 && progress < 0.98) {
      found.push({ name: city.name, lat: city.lat, lng: city.lng, kind: 'via', at: round5(progress) });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The path the app should draw and simulate: the stored polyline, or the waypoints if none yet. */
export function effectivePath(job: { route_path: PathPoint[]; waypoints: Waypoint[] }): PathPoint[] {
  if (Array.isArray(job.route_path) && job.route_path.length >= 2) return job.route_path;
  return (job.waypoints ?? []).map((w) => [w.lat, w.lng] as PathPoint);
}

/**
 * Fast position lookup along one path. Build it once per path, then call it
 * every animation frame: each lookup is a binary search, not a full walk.
 */
export function pathSampler(path: PathPoint[]): (progress: number) => LatLng {
  if (path.length === 0) return () => ({ lat: 0, lng: 0 });
  const cum = cumulativeKm(path);
  const total = cum[cum.length - 1];
  if (path.length === 1 || total === 0) return () => toLatLng(path[0]);
  return (progress: number) => {
    const target = Math.max(0, Math.min(1, progress)) * total;
    let lo = 1;
    let hi = path.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const seg = cum[lo] - cum[lo - 1];
    const t = seg === 0 ? 0 : (target - cum[lo - 1]) / seg;
    return {
      lat: path[lo - 1][0] + (path[lo][0] - path[lo - 1][0]) * t,
      lng: path[lo - 1][1] + (path[lo][1] - path[lo - 1][1]) * t,
    };
  };
}
