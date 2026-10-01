'use client';

import { useEffect, useState } from 'react';
import type { Weather } from '@/lib/types';
import { Icon } from '../Icon';

type Spot = { lat: number; lng: number; place: string };

function useWeather(spot: Spot | null): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null);
  // Round the position so a moving truck re-fetches roughly every 10 km, not on every telemetry tick.
  const key = spot ? `${spot.lat.toFixed(1)},${spot.lng.toFixed(1)},${spot.place}` : '';
  useEffect(() => {
    if (!key) return;
    const [lat, lng, place] = key.split(',');
    let stale = false;
    const load = () =>
      fetch(`/api/weather?lat=${lat}&lng=${lng}&place=${encodeURIComponent(place)}`)
        .then((r) => (r.ok ? (r.json() as Promise<Weather>) : null))
        .then((w) => {
          if (!stale && w) setWeather(w);
        })
        .catch(() => undefined);
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [key]);
  return weather;
}

function Line({ label, weather }: { label: string; weather: Weather | null }) {
  if (!weather) {
    return (
      <p className="font-bold text-noir/60">
        {label}: loading weather
      </p>
    );
  }
  if (weather.source === 'unavailable') {
    return (
      <p className="font-bold text-noir/60">
        {label}: weather unavailable
      </p>
    );
  }
  return (
    <div className={`rounded-lg ${weather.severe ? 'bg-noir px-2 py-1 text-pearl' : ''}`}>
      <p className="text-xs font-extrabold uppercase tracking-wide opacity-70">
        {label} · {weather.place}
      </p>
      <p className="flex items-baseline gap-2 font-black leading-tight">
        <span className="text-xl sm:text-2xl">{weather.temp_c ?? '--'}°</span>
        <span className="text-sm">{weather.condition}</span>
      </p>
      <p className="hidden text-xs font-bold opacity-75 sm:block">
        Wind {weather.wind_kmph ?? '--'} km/h{(weather.rain_mm ?? 0) > 0 ? ` · Rain ${weather.rain_mm} mm/h` : ''}
      </p>
    </div>
  );
}

/** Small weather card that floats over the map: conditions at the truck and at the destination. */
export function WeatherWidget({ here, destination }: { here: Spot | null; destination: Spot | null }) {
  const now = useWeather(here);
  const ahead = useWeather(destination);
  return (
    <div className="glass pointer-events-auto w-40 space-y-1.5 rounded-2xl bg-white/50 p-3 sm:w-48 sm:space-y-2 sm:p-3.5" aria-label="Weather on the route">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-midnight">
        <Icon name="cloud" size={16} /> Weather
      </p>
      <Line label="Now" weather={now} />
      {/* Phones show only the weather at the truck, to leave the map visible. */}
      {destination ? (
        <div className="hidden sm:block">
          <Line label="Ahead" weather={ahead} />
        </div>
      ) : null}
    </div>
  );
}
