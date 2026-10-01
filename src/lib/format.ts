import type { JobStatus, ShipmentStatus } from './types';

// Every date is shown in Indian Standard Time, on the server (UTC on Vercel) and in the browser alike.
const TZ = 'Asia/Kolkata';

/** Indian rupees with Indian digit grouping, e.g. "₹ 1,25,000". The space is non-breaking so an amount never wraps. */
export const inr = (n: number) => `₹\u00A0${Math.round(Number(n)).toLocaleString('en-IN')}`;
export const km = (n: number) => `${Math.round(Number(n)).toLocaleString('en-IN')} km`;
export const kgs = (n: number) => `${Math.round(Number(n)).toLocaleString('en-IN')} kg`;

export function dateShort(value: string): string {
  // Date-only strings are calendar dates: format them without shifting time zones.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: TZ }).format(d);
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  }).format(new Date(value));
}

export function timeAgo(value: string, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const SHIPMENT_STATUS: Record<ShipmentStatus, string> = {
  pending: 'Finding a truck',
  offered: 'Offered to a driver',
  assigned: 'Driver assigned',
  in_transit: 'On the road',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const JOB_STATUS: Record<JobStatus, string> = {
  offered: 'Offer',
  assigned: 'Ready to start',
  in_transit: 'On the road',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const CATEGORY_LABEL: Record<string, string> = {
  general: 'General goods',
  fragile: 'Fragile',
  perishable: 'Perishable',
  hazardous: 'Hazardous',
  machinery: 'Machinery',
  electronics: 'Electronics',
};

export function providerName(provider: string): string {
  if (provider === 'gemini') return 'Google Gemini';
  if (provider === 'groq') return 'Groq';
  return 'Logic Lanes built-in engine';
}

/** 'YYYY-MM' of a timestamp in Indian time, for month-to-date totals. */
export const monthKey = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(value));

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
