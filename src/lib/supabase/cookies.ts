/** The two portals that sign in through Supabase Auth. The admin uses a passcode instead. */
export type PortalRole = 'client' | 'driver';

/**
 * Each portal keeps its Supabase session in its own cookie, so a client and a
 * driver can be signed in side by side in one browser (handy for demos).
 * Shared by the middleware and the server helpers, so it must stay free of
 * server-only imports.
 */
export const authCookieName = (role: PortalRole) => `fp-${role}-auth`;

export const DASHBOARD: Record<PortalRole, string> = {
  client: '/client/dashboard',
  driver: '/driver/dashboard',
};
