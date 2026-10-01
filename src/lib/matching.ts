import { ROAD_FACTOR, haversineKm } from './geo';
import type { City, Driver, JobCard, Shipment, VehicleType } from './types';

export type LiveJob = JobCard & { shipment: Shipment };

export type Match = {
  driver: Driver;
  score: number;
  reason: string;
  backhaul: boolean;
  deadhead_km: number;
};

type ShipmentNeed = Pick<Shipment, 'origin_city' | 'dest_city' | 'weight_kg' | 'pickup_date' | 'priority'>;

/** Longest empty run we will ask an idle driver to make to reach a pickup. */
const MAX_DEADHEAD_KM = 600;

/**
 * Rank drivers for a shipment. The strongest signal is a truck that is about
 * to finish a delivery in the shipment's origin city: giving it this load
 * turns an empty return trip into a paid one.
 */
export function rankDrivers(input: {
  shipment: ShipmentNeed;
  drivers: Driver[];
  vehicles: VehicleType[];
  cities: City[];
  liveJobs: LiveJob[];
  exclude?: string[];
}): Match[] {
  const { shipment, drivers, vehicles, cities, liveJobs } = input;
  const exclude = new Set(input.exclude ?? []);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const cityByName = new Map(cities.map((c) => [c.name, c]));
  const origin = cityByName.get(shipment.origin_city);
  if (!origin) return [];

  const pickupDeadline = new Date(`${shipment.pickup_date}T23:59:59`).getTime() + 24 * 3600 * 1000;
  const matches: Match[] = [];

  for (const driver of drivers) {
    if (exclude.has(driver.id) || driver.status === 'offline') continue;
    const vehicle = vehicleById.get(driver.vehicle_type);
    if (!vehicle || vehicle.capacity_kg < shipment.weight_kg) continue;

    const jobs = liveJobs.filter((j) => j.driver_id === driver.id);
    const current = jobs.find((j) => j.status === 'in_transit') ?? jobs.find((j) => j.status === 'assigned');
    // One running trip plus one queued return load is the most a driver can hold.
    if (jobs.length >= 2) continue;

    let score = 0;
    let backhaul = false;
    let deadhead_km = 0;
    const why: string[] = [];

    if (current) {
      const endsAtOrigin = current.shipment.dest_city === shipment.origin_city;
      if (!endsAtOrigin) continue; // busy elsewhere
      if (current.eta && new Date(current.eta).getTime() > pickupDeadline) continue; // arrives too late
      backhaul = true;
      score += 100;
      why.push(`Finishing a delivery in ${shipment.origin_city}, so this load fills the return trip`);
      if (shipment.dest_city === driver.home_city || shipment.dest_city === current.shipment.origin_city) {
        score += 30;
        why.push(`${shipment.dest_city} is on the way home`);
      }
    } else {
      const here =
        driver.current_lat != null && driver.current_lng != null
          ? { lat: driver.current_lat, lng: driver.current_lng }
          : cityByName.get(driver.current_city ?? driver.home_city);
      if (!here) continue;
      deadhead_km = Math.round(haversineKm(here, origin) * ROAD_FACTOR);
      if (deadhead_km > MAX_DEADHEAD_KM) continue;
      if (driver.current_city === shipment.origin_city || deadhead_km < 25) {
        deadhead_km = 0;
        score += 70;
        why.push(`Already in ${shipment.origin_city}, 0 km empty run to pickup`);
        // An idle truck parked away from home that gets a load towards home is a return trip too.
        if (driver.home_city !== shipment.origin_city && shipment.dest_city === driver.home_city) {
          backhaul = true;
          score += 30;
          why.push(`Load takes the truck home to ${driver.home_city}`);
        }
      } else {
        score += Math.max(0, 50 - deadhead_km / 12);
        why.push(`${deadhead_km} km empty run to pickup`);
      }
    }

    if (driver.driver_type === 'full_time') {
      score += 15;
      why.push('Full-time driver, assigned automatically');
    } else {
      why.push('Gig driver, must accept the offer');
    }
    score += Number(driver.rating) * 2;
    if (shipment.priority >= 2 && Number(driver.rating) >= 4.7) {
      score += 8;
      why.push('Top-rated driver reserved for Premium');
    }
    // Prefer the tightest-fitting truck so big trucks stay free for big loads.
    score -= ((vehicle.capacity_kg - shipment.weight_kg) / vehicle.capacity_kg) * 10;

    matches.push({ driver, score: Math.round(score), reason: `${why.join('. ')}.`, backhaul, deadhead_km });
  }

  return matches.sort((a, b) => b.score - a.score);
}
