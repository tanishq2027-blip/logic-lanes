import 'server-only';
import type { Session } from './session';
import type { JobCard, Shipment } from './types';

/** May this session see or act on this Job Card? */
export function canAccessJob(session: Session | null, job: JobCard, shipment: Shipment): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'driver') return job.driver_id === session.id;
  return shipment.client_id === session.id;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
