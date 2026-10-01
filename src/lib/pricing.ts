import type { MembershipTier, VehicleType } from './types';

/** A load carried on a truck's return leg is cheaper: the truck was going that way empty anyway. */
export const BACKHAUL_DISCOUNT_PCT = 18;
const MIN_FARE_INR = 1500;
/**
 * Top of the rate band when the database has no `rate_max_per_km_inr` yet
 * (supabase/upgrade.sql not run): market bands run roughly a third above
 * their floor, so this keeps quotes in the right range until it is.
 */
const FALLBACK_BAND_SPREAD = 1.35;

/** Smallest vehicle class that can carry the load. */
export function pickVehicle(weightKg: number, vehicles: VehicleType[]): VehicleType | null {
  const sorted = [...vehicles].sort((a, b) => a.capacity_kg - b.capacity_kg);
  return sorted.find((v) => v.capacity_kg >= weightKg) ?? null;
}

/** Per-km rate band of a vehicle class, in rupees. */
export function rateBand(vehicle: VehicleType): { min: number; max: number } {
  const min = Number(vehicle.rate_per_km_inr);
  const max = Number(vehicle.rate_max_per_km_inr ?? 0);
  return { min, max: max > min ? max : Math.round(min * FALLBACK_BAND_SPREAD) };
}

/**
 * Per-km rate for this load. Each class covers a weight range, from the
 * capacity of the next smaller class up to its own; a load at the bottom of
 * that range pays the bottom of the band, a full truck pays the top.
 */
export function ratePerKm(weightKg: number, vehicle: VehicleType, vehicles: VehicleType[]): number {
  const { min, max } = rateBand(vehicle);
  const floorKg = Math.max(0, ...vehicles.filter((v) => v.capacity_kg < vehicle.capacity_kg).map((v) => v.capacity_kg));
  const span = vehicle.capacity_kg - floorKg;
  const position = span > 0 ? Math.max(0, Math.min(1, (weightKg - floorKg) / span)) : 1;
  return Math.round((min + (max - min) * position) * 100) / 100;
}

/** What the driver takes home for a trip: gig drivers a share of freight, employees a trip incentive on top of salary. */
export function driverPayout(priceInr: number, driverType: 'gig' | 'full_time'): number {
  const share = driverType === 'gig' ? 0.7 : 0.08;
  return Math.round((priceInr * share) / 50) * 50;
}

export type Quote = { base_inr: number; rate_per_km: number; discount_pct: number; price_inr: number };

/** Freight = distance x per-km rate for the load's vehicle class, less membership and return-trip discounts. */
export function quote(input: {
  distanceKm: number;
  weightKg: number;
  /** The vehicle class the load needs (not necessarily the truck that ends up carrying it). */
  vehicle: VehicleType;
  vehicles: VehicleType[];
  tier: MembershipTier;
  backhaul: boolean;
}): Quote {
  const rate_per_km = ratePerKm(input.weightKg, input.vehicle, input.vehicles);
  const base = Math.max(MIN_FARE_INR, input.distanceKm * rate_per_km);
  const discount_pct = Number(input.tier.freight_discount_pct) + (input.backhaul ? BACKHAUL_DISCOUNT_PCT : 0);
  const price = base * (1 - discount_pct / 100);
  return {
    base_inr: Math.round(base / 100) * 100,
    rate_per_km,
    discount_pct,
    price_inr: Math.round(price / 100) * 100,
  };
}
