'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { pathUntil, pointAtProgress } from '@/lib/geo';
import type { LatLng, PathPoint, Waypoint } from '@/lib/types';

const W = 640;
const H = 420;
const PAD = 56;

/**
 * Schematic route map drawn as SVG from the Job Card's stored coordinates.
 * Used for client tracking and the admin panel, and as the driver map's
 * fallback if the map library cannot load, so there is always a map on screen.
 */
export function SketchMap({
  path,
  waypoints,
  progress,
  incidents = [],
  showTruck = true,
  className = '',
}: {
  path: PathPoint[];
  waypoints: Waypoint[];
  progress: number;
  incidents?: LatLng[];
  showTruck?: boolean;
  className?: string;
}) {
  const view = useMemo(() => {
    const pts = path.length >= 2 ? path : waypoints.map((w) => [w.lat, w.lng] as PathPoint);
    if (pts.length === 0) return null;
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max(0.05, (maxLng - minLng) * kx);
    const spanY = Math.max(0.05, maxLat - minLat);
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const project = (lat: number, lng: number) => ({
      x: offX + (lng - minLng) * kx * scale,
      y: offY + (maxLat - lat) * scale,
    });
    const line = (list: PathPoint[]) => list.map((p) => {
      const q = project(p[0], p[1]);
      return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    }).join(' ');
    return { pts, project, line };
  }, [path, waypoints]);

  if (!view) {
    return <div className={`flex items-center justify-center font-bold text-noir/60 ${className}`}>Route not available yet</div>;
  }

  const here = pointAtProgress(view.pts, progress);
  const truck = view.project(here.lat, here.lng);
  const done = pathUntil(view.pts, progress);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Route map from ${waypoints[0]?.name ?? 'origin'} to ${waypoints[waypoints.length - 1]?.name ?? 'destination'}, ${Math.round(progress * 100)} percent complete`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="sketch-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="#122C4F" strokeOpacity="0.08" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#FBF9E4" />
      <rect width={W} height={H} fill="url(#sketch-grid)" />

      {/* Whole route in Midnight, the part already driven in Noir */}
      <polyline points={view.line(view.pts)} fill="none" stroke="#122C4F" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      {showTruck && progress > 0 ? (
        <polyline points={view.line(done)} fill="none" stroke="#000000" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}

      {waypoints.map((w, i) => {
        const p = view.project(w.lat, w.lng);
        const end = w.kind === 'origin' || w.kind === 'destination';
        // Labels go on the side with more room; mid-map they alternate so neighbours do not collide.
        const left = p.x > W * 0.6 ? true : p.x < W * 0.4 ? false : i % 2 === 1;
        return (
          <g key={`${w.name}-${i}`}>
            {w.kind === 'detour' ? (
              <rect x={p.x - 8} y={p.y - 8} width="16" height="16" transform={`rotate(45 ${p.x} ${p.y})`} fill="#000000" stroke="#FBF9E4" strokeWidth="2" />
            ) : (
              <circle cx={p.x} cy={p.y} r={end ? 10 : 6} fill={end ? '#000000' : '#FBF9E4'} stroke="#000000" strokeWidth="3" />
            )}
            <text
              x={p.x + (left ? -14 : 14)}
              y={p.y + 5}
              textAnchor={left ? 'end' : 'start'}
              fontSize={end || w.kind === 'detour' ? 16 : 13}
              fontWeight={end || w.kind === 'detour' ? 900 : 700}
              fill="#000000"
              stroke="#FBF9E4"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {w.kind === 'detour' ? `Detour: ${w.name}` : w.name}
            </text>
          </g>
        );
      })}

      {incidents.map((inc, i) => {
        const p = view.project(inc.lat, inc.lng);
        return (
          <g key={i} transform={`translate(${p.x} ${p.y})`}>
            <path d="M0 -16 15 11H-15Z" fill="#000000" stroke="#FBF9E4" strokeWidth="2.5" strokeLinejoin="round" />
            <text y="7" textAnchor="middle" fontSize="15" fontWeight="900" fill="#FBF9E4">
              !
            </text>
          </g>
        );
      })}

      {showTruck ? (
        <motion.g initial={false} animate={{ x: truck.x, y: truck.y }} transition={{ duration: 1.2, ease: 'linear' }}>
          <circle r="18" fill="#122C4F" opacity="0.2">
            <animate attributeName="r" values="14;24;14" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle r="12" fill="#000000" stroke="#FBF9E4" strokeWidth="3" />
          <path d="M-6 -3h7v6h-7zM1 -1h3l2 2v2H1z" fill="#FBF9E4" />
        </motion.g>
      ) : null}
    </svg>
  );
}
