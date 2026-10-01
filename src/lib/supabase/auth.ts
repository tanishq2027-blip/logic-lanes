import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { authCookieName, type PortalRole } from './cookies';

/**
 * @supabase/ssr writes session cookies readable by page scripts, because its
 * browser client needs them. This app only ever talks to Supabase Auth from
 * the server, so the cookies are made httpOnly: a script injected into a page
 * cannot read the tokens.
 */
export function hardened<T extends object>(options: T | undefined): T & { httpOnly: true; secure: boolean; sameSite: 'lax' } {
  return { ...(options as T), httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** True when this browser carries a session cookie for the portal (possibly expired). */
export async function hasAuthCookie(role: PortalRole): Promise<boolean> {
  const jar = await cookies();
  const name = authCookieName(role);
  // Large sessions are split into `name.0`, `name.1`, ...
  return jar.getAll().some((c) => c.name === name || c.name.startsWith(`${name}.`));
}

/**
 * Supabase Auth client for one portal, bound to the request's cookies.
 * Works in Server Components, Server Actions and Route Handlers (Node or Edge).
 * It uses the anon key and the user's own token, so RLS applies to anything
 * queried through it.
 */
export async function createAuthClient(role: PortalRole): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase is not configured.');
  const jar = await cookies();
  return createServerClient(url, anon, {
    cookieOptions: { name: authCookieName(role) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, hardened(options));
        } catch {
          // Server Components cannot write cookies. The middleware refreshes the session instead.
        }
      },
    },
  });
}
