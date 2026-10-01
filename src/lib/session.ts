import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { one } from './data';
import { createAuthClient, hasAuthCookie, isAuthConfigured } from './supabase/auth';
import type { PortalRole } from './supabase/cookies';
import { getDb, isSupabaseConfigured } from './supabase/server';
import type { Client, Driver, Role } from './types';

/**
 * Who is signed in.
 *
 * - Clients and drivers sign in with Supabase Auth. Their `id` here is the id
 *   of their row in `clients` / `drivers` (found through `auth_user_id`), which
 *   is what the rest of the app keys on.
 * - The admin uses a passcode and a signed, httpOnly cookie (Web Crypto, so it
 *   also verifies on the Edge runtime).
 */
export type Session = { role: Role; id: string; name: string; iat: number };

// ---------------------------------------------------------------------------
// Clients and drivers: Supabase Auth
// ---------------------------------------------------------------------------
const portalSession = cache(async (role: PortalRole): Promise<Session | null> => {
  if (!isAuthConfigured() || !isSupabaseConfigured()) return null;
  // No cookie, no session: skip the round trip to Supabase.
  if (!(await hasAuthCookie(role))) return null;

  const supabase = await createAuthClient(role);
  // getUser() asks the Auth server to verify the token; never trust the cookie's contents alone.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const db = getDb();
  if (role === 'client') {
    const client = await one<Client>(db.from('clients').select('*').eq('auth_user_id', data.user.id));
    return client ? { role, id: client.id, name: client.company_name, iat: 0 } : null;
  }
  const driver = await one<Driver>(db.from('drivers').select('*').eq('auth_user_id', data.user.id));
  return driver ? { role, id: driver.id, name: driver.name, iat: 0 } : null;
});

// ---------------------------------------------------------------------------
// Admin: passcode + signed cookie
// ---------------------------------------------------------------------------
const ADMIN_COOKIE = 'fp_admin';
const MAX_AGE_SEC = 60 * 60 * 12;
const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey | null> {
  const s = secret();
  if (!s) return null;
  return crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function encode(session: Session): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const payload = toBase64Url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${toBase64Url(sig)}`;
}

async function decode(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const key = await hmacKey();
    if (!key) return null;
    const ok = await crypto.subtle.verify('HMAC', key, fromBase64Url(sig), enc.encode(payload));
    if (!ok) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Session;
    if (session.role !== 'admin' || Date.now() / 1000 - session.iat > MAX_AGE_SEC) return null;
    return session;
  } catch {
    return null;
  }
}

async function adminSession(): Promise<Session | null> {
  const jar = await cookies();
  return decode(jar.get(ADMIN_COOKIE)?.value);
}

export async function startAdminSession(input: { id: string; name: string }): Promise<boolean> {
  const token = await encode({ role: 'admin', ...input, iat: Math.floor(Date.now() / 1000) });
  if (!token) return false;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
  return true;
}

export async function endAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

// ---------------------------------------------------------------------------
// Shared entry points
// ---------------------------------------------------------------------------
export async function getSession(role: Role): Promise<Session | null> {
  return role === 'admin' ? adminSession() : portalSession(role);
}

/** Every role signed in on this browser. Used by API routes that serve more than one role. */
export async function getSessions(): Promise<Session[]> {
  const all = await Promise.all([getSession('client'), getSession('driver'), getSession('admin')]);
  return all.filter((s): s is Session => s !== null);
}

/** Use in portal pages: visitors who are not signed in to this portal go back to its sign-in card. */
export async function requireSession(role: PortalRole): Promise<Session> {
  const session = await getSession(role);
  if (!session) redirect(`/?portal=${role}`);
  return session;
}
