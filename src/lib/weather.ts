import type { Weather } from './types';

const TIMEOUT_MS = 4000;

function wmoCondition(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 63) return 'Rain';
  if (code <= 67) return 'Heavy rain';
  if (code <= 77) return 'Snow';
  if (code <= 81) return 'Rain showers';
  if (code === 82) return 'Violent rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

async function fromOpenWeather(lat: number, lng: number, place: string, key: string): Promise<Weather> {
  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('units', 'metric');
  url.searchParams.set('appid', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenWeather HTTP ${res.status}`);
  const d = (await res.json()) as {
    weather?: { id: number; description: string }[];
    main?: { temp: number };
    wind?: { speed: number };
    rain?: { '1h'?: number };
  };
  const id = d.weather?.[0]?.id ?? 800;
  const rain = d.rain?.['1h'] ?? 0;
  const wind = d.wind ? Math.round(d.wind.speed * 3.6) : null;
  const desc = d.weather?.[0]?.description ?? 'Clear sky';
  return {
    place,
    temp_c: d.main ? Math.round(d.main.temp) : null,
    condition: desc.charAt(0).toUpperCase() + desc.slice(1),
    wind_kmph: wind,
    rain_mm: rain,
    // 2xx thunderstorm, 502+ heavy rain, 6xx snow, 781 tornado
    severe: id < 300 || (id >= 502 && id < 600) || (id >= 600 && id < 700) || id === 781 || rain >= 7.5 || (wind ?? 0) >= 50,
    source: 'openweather',
  };
}

/** WeatherAPI.com condition codes that mean dangerous driving: thunder, heavy or torrential rain, blizzard, heavy snow. */
const WEATHERAPI_SEVERE = new Set([1087, 1117, 1192, 1195, 1225, 1243, 1246, 1273, 1276, 1279, 1282]);

async function fromWeatherApi(lat: number, lng: number, place: string, key: string): Promise<Weather> {
  const url = new URL('https://api.weatherapi.com/v1/current.json');
  url.searchParams.set('key', key);
  url.searchParams.set('q', `${lat},${lng}`);
  url.searchParams.set('aqi', 'no');
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`WeatherAPI HTTP ${res.status}`);
  const d = (await res.json()) as {
    current?: { temp_c: number; wind_kph: number; precip_mm: number; condition?: { text?: string; code?: number } };
  };
  if (!d.current) throw new Error('WeatherAPI returned no current weather');
  const c = d.current;
  return {
    place,
    temp_c: Math.round(c.temp_c),
    condition: c.condition?.text?.trim() || 'Clear',
    wind_kmph: Math.round(c.wind_kph),
    rain_mm: c.precip_mm,
    severe: WEATHERAPI_SEVERE.has(c.condition?.code ?? 0) || c.precip_mm >= 7.5 || c.wind_kph >= 50,
    source: 'weatherapi',
  };
}

async function fromOpenMeteo(lat: number, lng: number, place: string): Promise<Weather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,precipitation,weather_code,wind_speed_10m');
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d = (await res.json()) as {
    current?: { temperature_2m: number; precipitation: number; weather_code: number; wind_speed_10m: number };
  };
  if (!d.current) throw new Error('Open-Meteo returned no current weather');
  const c = d.current;
  return {
    place,
    temp_c: Math.round(c.temperature_2m),
    condition: wmoCondition(c.weather_code),
    wind_kmph: Math.round(c.wind_speed_10m),
    rain_mm: c.precipitation,
    severe: c.weather_code >= 95 || c.weather_code === 82 || (c.weather_code >= 65 && c.weather_code <= 67) || c.precipitation >= 7.5 || c.wind_speed_10m >= 50,
    source: 'open-meteo',
  };
}

/**
 * Tries each configured provider in turn: WeatherAPI.com, then OpenWeather,
 * then Open-Meteo, which needs no key. Never throws.
 */
export async function fetchWeather(lat: number, lng: number, place: string): Promise<Weather> {
  const weatherApiKey = process.env.WEATHERAPI_KEY;
  if (weatherApiKey) {
    try {
      return await fromWeatherApi(lat, lng, place, weatherApiKey);
    } catch {
      // fall through to the next provider
    }
  }
  const key = process.env.OPENWEATHER_API_KEY;
  if (key) {
    try {
      return await fromOpenWeather(lat, lng, place, key);
    } catch {
      // fall through to Open-Meteo
    }
  }
  try {
    return await fromOpenMeteo(lat, lng, place);
  } catch {
    return { place, temp_c: null, condition: 'Weather unavailable', wind_kmph: null, rain_mm: null, severe: false, source: 'unavailable' };
  }
}
