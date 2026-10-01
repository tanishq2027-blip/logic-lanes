import type { AiPrompt } from './failover';
import type { IncidentType, Weather } from '../types';

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General goods',
  fragile: 'Fragile goods',
  perishable: 'Perishable goods',
  hazardous: 'Hazardous goods',
  machinery: 'Machinery',
  electronics: 'Electronics',
};

export const kg = (n: number) => `${Math.round(n).toLocaleString('en-IN')} kg`;

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ---------------------------------------------------------------------------
// Goods and route description
// ---------------------------------------------------------------------------
export type SummaryContext = {
  category: string;
  goods: string;
  weight_kg: number;
  origin: string;
  dest: string;
  via: string[];
  vehicle: string;
  routing_note: string;
  distance_km: number;
  duration_min: number;
  backhaul: boolean;
  weather: Weather[];
};

function weatherSentence(weather: Weather[]): string {
  const known = weather.filter((w) => w.source !== 'unavailable');
  if (known.length === 0) return '';
  const severe = known.find((w) => w.severe);
  if (severe) return `${severe.condition} expected near ${severe.place}, slow down and keep extra distance.`;
  const wet = known.find((w) => (w.rain_mm ?? 0) > 0.2);
  if (wet) return `${wet.condition} near ${wet.place}.`;
  return `Weather is clear along the route (${known[0].condition.toLowerCase()} at ${known[0].place}).`;
}

export function deterministicSummary(c: SummaryContext): string {
  const via = c.via.slice(0, 4);
  const parts = [
    `${CATEGORY_LABEL[c.category] ?? 'Goods'}, ${kg(c.weight_kg)}.`,
    `Route from ${c.origin} to ${c.dest}${via.length ? ` via ${listOf(via)}` : ''}, about ${Math.round(c.distance_km)} km (${hours(c.duration_min)} driving).`,
    c.routing_note,
    c.backhaul ? 'Return-trip load: the truck was heading this way anyway.' : '',
    weatherSentence(c.weather),
  ];
  return parts.filter(Boolean).join(' ');
}

export function summaryPrompt(c: SummaryContext): AiPrompt {
  return {
    system:
      'You are the dispatch assistant of Logic Lanes, a road freight platform in India. ' +
      'Write a transport briefing that a truck driver and the client can both read at a glance. ' +
      'Rules: plain English, 2 to 3 short sentences, at most 55 words, no markdown, no emojis, no greetings. ' +
      'Start with the goods category and weight. Then the route: name the national highway that connects these ' +
      'cities only if you are sure of it. End with the most important weather or handling risk. ' +
      'Use only the facts given. Example: "Fragile goods, 500 kg. Route via NH48. Heavy rain expected near Pune."',
    user: JSON.stringify({
      goods: c.goods,
      category: c.category,
      weight_kg: c.weight_kg,
      from: c.origin,
      to: c.dest,
      via_cities: c.via,
      distance_km: Math.round(c.distance_km),
      driving_time: hours(c.duration_min),
      vehicle: c.vehicle,
      vehicle_routing_rule: c.routing_note,
      return_trip_load: c.backhaul,
      weather_now: c.weather
        .filter((w) => w.source !== 'unavailable')
        .map((w) => ({ near: w.place, condition: w.condition, temp_c: w.temp_c, rain_mm_per_h: w.rain_mm, severe: w.severe })),
    }),
  };
}

// ---------------------------------------------------------------------------
// Reroute advisory
// ---------------------------------------------------------------------------
export type RerouteContext = {
  reference: string;
  incident: IncidentType;
  severity: number;
  near: string;
  detour: string;
  added_km: number;
  delay_min: number;
  dest: string;
  source: 'admin' | 'google_traffic';
};

export const INCIDENT_LABEL: Record<IncidentType, string> = {
  accident: 'Accident',
  traffic: 'Severe traffic',
  weather: 'Severe weather',
  road_closure: 'Road closure',
};

export function deterministicAdvisory(c: RerouteContext): string {
  return (
    `${INCIDENT_LABEL[c.incident]} reported near ${c.near}. ` +
    `New route goes via ${c.detour}, adding about ${c.added_km} km. ` +
    `Expected delay to ${c.dest}: ${hours(c.delay_min)}.`
  );
}

export function advisoryPrompt(c: RerouteContext): AiPrompt {
  return {
    system:
      'You are the dispatch assistant of Logic Lanes, a road freight platform in India. ' +
      'A truck has just been rerouted. Write one alert that the driver and the client will both receive. ' +
      'Rules: plain English, 2 short sentences, at most 40 words, no markdown, no emojis. ' +
      'Say what happened and where, the new route, and the expected delay. Use only the facts given.',
    user: JSON.stringify({
      shipment: c.reference,
      incident: INCIDENT_LABEL[c.incident],
      severity_1_to_3: c.severity,
      incident_near: c.near,
      detour_via: c.detour,
      extra_km: c.added_km,
      expected_delay: hours(c.delay_min),
      destination: c.dest,
      detected_by: 'control room',
    }),
  };
}
