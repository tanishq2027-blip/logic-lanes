'use client';

import 'leaflet/dist/leaflet.css';
import type { LayerGroup, Map as LeafletMap, Marker, Polyline } from 'leaflet';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { effectivePath, pathSampler } from '@/lib/geo';
import { MARKER_ICONS, MIDNIGHT, TILE_ATTRIBUTION, TILE_URL, type MarkerKind } from '@/lib/mapStyle';
import type { JobCard, LatLng } from '@/lib/types';
import { Icon } from '../Icon';
import { SketchMap } from '../SketchMap';

type Leaflet = typeof import('leaflet');

/** Telemetry arrives every 5 seconds; the marker takes about that long to cover each update, so it never stops. */
const GLIDE_MS = 5200;
/** A jump larger than this share of the route is a correction (reroute, replay), not driving: snap instead of gliding. */
const SNAP_BEYOND = 0.2;
/** Zoom used when following the truck: close enough that real-time driving is visible. */
const FOLLOW_ZOOM = 14;

type Props = {
  job: JobCard;
  incidents?: LatLng[];
  /** Accessible name for the map. */
  label: string;
  truckTitle?: string;
  /** Zoom buttons and scroll-wheel zoom. Turn off for small preview maps inside a scrolling page. */
  controls?: boolean;
  className?: string;
  /** Told when road directions could not be fetched and the estimated route is shown instead. */
  onRouteNote?: (note: string | null) => void;
  /** Overlays (weather, prompts). Positioned by the caller, above the map. */
  children?: ReactNode;
};

/**
 * Live route map: OpenStreetMap tiles drawn with Leaflet, the route as a
 * Midnight polyline, Noir markers, and a truck that drives smoothly along the
 * line between telemetry updates.
 *
 * Road geometry comes from OpenRouteService through `/api/route`, which stores
 * it on the Job Card; until that answers (or if no key is set) the estimated
 * city-to-city route is drawn. If the map library itself cannot load, the
 * schematic SVG map takes over, so the screen is never blank.
 */
export function RouteMap({ job, incidents = [], label, truckTitle = 'Truck', controls = true, className = '', onRouteNote, children }: Props) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const leaflet = useRef<Leaflet | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const line = useRef<Polyline | null>(null);
  const pins = useRef<LayerGroup | null>(null);
  const truck = useRef<Marker | null>(null);
  const requested = useRef('');
  const shown = useRef<{ route: string; progress: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Follow mode: zoomed in on the truck with the map moving under it, like a navigation app.
  // At real-time speed a truck covers about 15 m a second, which only shows at street level.
  const [follow, setFollow] = useState(false);
  const following = useRef(false);
  following.current = follow;

  const path = useMemo(() => effectivePath(job), [job]);
  const sample = useMemo(() => pathSampler(path), [path]);
  const progress = Number(job.progress);
  const end = job.waypoints[job.waypoints.length - 1];
  const estimated = job.route_source === 'estimate';
  const routeKey = `${job.id}:${job.route_version}:${job.route_source}:${path.length}`;

  // Create the map once. Leaflet touches `window` when imported, so it is loaded here, in the browser only.
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    import('leaflet')
      .then((mod) => {
        if (cancelled || !holder.current || map.current) return;
        const L = (mod.default ?? mod) as Leaflet;
        leaflet.current = L;
        const start = sample(progress);
        const m = L.map(holder.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: controls }).setView([start.lat, start.lng], 7);
        if (controls) L.control.zoom({ position: 'topright' }).addTo(m);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(m);
        line.current = L.polyline([], { color: MIDNIGHT, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(m);
        pins.current = L.layerGroup().addTo(m);
        map.current = m;
        // Dragging the map by hand means "let me look around": stop re-centring on the truck.
        m.on('dragstart', () => setFollow(false));
        // Leaflet measures its container once; tell it when the layout changes.
        resize = new ResizeObserver(() => m.invalidateSize());
        resize.observe(holder.current);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      line.current = null;
      pins.current = null;
      truck.current = null;
      shown.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const icon = (kind: MarkerKind, anchorBottom = false) => {
    const L = leaflet.current as Leaflet;
    const { url, size } = MARKER_ICONS[kind];
    return L.icon({ iconUrl: url, iconSize: [size, size], iconAnchor: [size / 2, anchorBottom ? size - 2 : size / 2] });
  };

  // Redraw the route and re-frame the map whenever the stored route changes (new job, reroute, road geometry saved).
  useEffect(() => {
    if (!ready || !map.current || !line.current || path.length < 2) return;
    line.current.setLatLngs(path);
    if (!following.current) map.current.fitBounds(line.current.getBounds(), { padding: controls ? [56, 56] : [28, 28] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeKey]);

  function toggleFollow() {
    const m = map.current;
    if (!m) return;
    if (follow) {
      setFollow(false);
      if (line.current && path.length >= 2) m.fitBounds(line.current.getBounds(), { padding: controls ? [56, 56] : [28, 28] });
      return;
    }
    const at = truck.current?.getLatLng() ?? sample(progress);
    m.setView(at, Math.max(m.getZoom(), FOLLOW_ZOOM), { animate: true });
    setFollow(true);
  }

  // Fixed markers: pickup, drop-off, detours, incidents.
  const pinKey = `${routeKey}:${incidents.map((p) => `${p.lat},${p.lng}`).join('|')}`;
  useEffect(() => {
    const L = leaflet.current;
    const group = pins.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    const add = (p: LatLng, kind: MarkerKind, title: string, z: number, anchorBottom = false) =>
      L.marker([p.lat, p.lng], { icon: icon(kind, anchorBottom), title, alt: title, keyboard: false, zIndexOffset: z }).addTo(group);
    const origin = job.waypoints[0];
    if (origin) add(origin, 'origin', `Pickup: ${origin.name}`, 100);
    if (end) add(end, 'destination', `Drop-off: ${end.name}`, 110, true);
    for (const w of job.waypoints) if (w.kind === 'detour') add(w, 'detour', `Detour via ${w.name}`, 120);
    for (const p of incidents) add(p, 'incident', 'Incident reported here', 130);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey]);

  // The truck. It drives along the route line from where it is shown to the latest reported
  // position, so it follows the road's bends and keeps moving between telemetry updates.
  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current) return;
    const place = (p: number) => {
      const at = sample(p);
      if (!truck.current) {
        truck.current = L.marker([at.lat, at.lng], { icon: icon('truck'), title: truckTitle, alt: truckTitle, keyboard: false, zIndexOffset: 500 }).addTo(
          map.current as LeafletMap,
        );
      } else {
        truck.current.setLatLng([at.lat, at.lng]);
      }
      if (following.current) (map.current as LeafletMap).panTo([at.lat, at.lng], { animate: false });
    };

    const last = shown.current;
    const from = last?.progress ?? progress;
    const jump = progress - from;
    if (!last || last.route !== routeKey || jump < 0 || jump > SNAP_BEYOND) {
      shown.current = { route: routeKey, progress };
      place(progress);
      return;
    }
    if (jump === 0) return;

    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const p = from + jump * t;
      shown.current = { route: routeKey, progress: p };
      place(p);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // On the next update the glide simply continues from wherever the truck is shown.
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, progress, routeKey]);

  // Ask the server for real road geometry, once per route version.
  useEffect(() => {
    if (!estimated || job.waypoints.length < 2) {
      onRouteNote?.(null);
      return;
    }
    const key = `${job.id}:${job.route_version}`;
    if (requested.current === key) return;
    requested.current = key;
    const unavailable = 'Estimated route. Road directions are unavailable right now.';
    fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobCardId: job.id }),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; changed?: boolean; reason?: string }>)
      .then((data) => {
        if (data.ok) {
          onRouteNote?.(null);
          if (data.changed) router.refresh();
        } else {
          onRouteNote?.(
            data.reason === 'no_key'
              ? 'Estimated route. Add an OpenRouteService key for real roads.'
              : data.reason === 'rate_limited'
                ? 'Estimated route. The routing service is busy right now.'
                : unavailable,
          );
        }
      })
      .catch(() => onRouteNote?.(unavailable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimated, job.id, job.route_version, job.waypoints.length, router]);

  return (
    <div className={`relative isolate overflow-hidden rounded-card border border-noir/10 bg-pearl shadow-card ${className}`}>
      {failed ? (
        <SketchMap path={path} waypoints={job.waypoints} progress={progress} incidents={incidents} showTruck className="h-full w-full" />
      ) : (
        <div ref={holder} className="fleet-map h-full w-full" role="application" aria-label={label} />
      )}
      {ready && !failed && job.status === 'in_transit' ? (
        <button
          type="button"
          onClick={toggleFollow}
          aria-pressed={follow}
          // Below the zoom buttons when they are shown, otherwise in the corner.
          className={`absolute right-[10px] z-[1100] inline-flex min-h-touch items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-extrabold transition-colors ${
            controls ? 'top-[124px]' : 'top-[10px]'
          } ${follow ? 'bg-midnight text-pearl shadow-card-accent' : 'glass bg-white/50 text-noir hover:bg-midnight hover:text-pearl'}`}
        >
          <Icon name={follow ? 'route' : 'pin'} size={18} />
          {follow ? 'Whole route' : 'Follow truck'}
        </button>
      ) : null}
      {children}
    </div>
  );
}
