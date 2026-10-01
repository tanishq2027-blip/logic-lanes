'use server';

import { redirect } from 'next/navigation';
import {
  checkEmail,
  checkName,
  checkPasscode,
  checkPhone,
  checkVehicleNumber,
  cleanEmail,
  cleanPhone,
  cleanVehicleNumber,
  type AuthErrorCode,
  type AuthResult,
  type ClientType,
  type DriverType,
  type FieldErrors,
} from '@/lib/authMessages';
import { one, rows } from '@/lib/data';
import { endAdminSession, startAdminSession } from '@/lib/session';
import { createAuthClient, isAuthConfigured } from '@/lib/supabase/auth';
import { DASHBOARD, type PortalRole } from '@/lib/supabase/cookies';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { City, Role, VehicleType } from '@/lib/types';

const isPortalRole = (role: unknown): role is PortalRole => role === 'client' || role === 'driver';
const text = (value: unknown, max = 300): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** Translate a Supabase Auth error into one of our bilingual messages. */
function mapAuthError(error: { code?: string; status?: number; message?: string } | null): AuthErrorCode {
  const code = error?.code ?? '';
  if (code === 'invalid_credentials') return 'invalid_credentials';
  if (code === 'email_not_confirmed') return 'email_not_confirmed';
  if (code === 'user_already_exists' || code === 'email_exists') return 'email_taken';
  if (code === 'weak_password') return 'passcode_short';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'email_invalid';
  if (error?.status === 429 || code.startsWith('over_')) return 'rate_limited';
  // Older Auth servers send no code for a bad login, only this message.
  if (/invalid login credentials/i.test(error?.message ?? '')) return 'invalid_credentials';
  return 'generic';
}

/** Does this auth user have its row in `clients` / `drivers`? Without it the dashboard has nothing to show. */
async function hasPortalRow(role: PortalRole, userId: string): Promise<boolean> {
  const table = role === 'client' ? 'clients' : 'drivers';
  const found = await rows<{ id: string }>(getDb().from(table).select('*').eq('auth_user_id', userId).limit(1));
  return found.length > 0;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export async function signIn(role: PortalRole, input: { email: string; passcode: string }): Promise<AuthResult> {
  if (!isPortalRole(role)) return { ok: false, error: 'generic' };
  if (!isAuthConfigured() || !isSupabaseConfigured()) return { ok: false, error: 'not_configured' };

  const email = cleanEmail(text(input?.email));
  const passcode = text(input?.passcode, 200);
  const fieldErrors: FieldErrors = {};
  const emailError = checkEmail(email);
  if (emailError) fieldErrors.email = emailError;
  if (!passcode) fieldErrors.passcode = 'passcode_short';
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  let failure: AuthErrorCode | null = null;
  try {
    const supabase = await createAuthClient(role);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: passcode });
    if (error || !data.user) {
      failure = mapAuthError(error);
    } else {
      // The role comes from public.profiles, never from user-editable metadata.
      const profile = await one<{ role: string }>(getDb().from('profiles').select('*').eq('id', data.user.id));
      if (profile && profile.role !== role) failure = profile.role === 'driver' ? 'wrong_portal_is_driver' : 'wrong_portal_is_client';
      else if (!profile || !(await hasPortalRow(role, data.user.id))) failure = 'profile_missing';
      if (failure) await supabase.auth.signOut({ scope: 'local' });
    }
  } catch {
    failure = 'generic';
  }
  if (failure) return { ok: false, error: failure };
  redirect(DASHBOARD[role]);
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
export type SignUpInput = {
  full_name: string;
  phone: string;
  email: string;
  passcode: string;
  city: string;
  client_type?: ClientType;
  driver_type?: DriverType;
  vehicle_type?: string;
  vehicle_number?: string;
};

export async function signUp(role: PortalRole, input: SignUpInput): Promise<AuthResult> {
  if (!isPortalRole(role)) return { ok: false, error: 'generic' };
  if (!isAuthConfigured() || !isSupabaseConfigured()) return { ok: false, error: 'not_configured' };

  const full_name = text(input?.full_name, 80).trim();
  const phone = cleanPhone(text(input?.phone, 20));
  const email = cleanEmail(text(input?.email));
  const passcode = text(input?.passcode, 200);
  const city = text(input?.city, 60);
  const vehicle_type = text(input?.vehicle_type, 40);
  const vehicle_number = cleanVehicleNumber(text(input?.vehicle_number, 20));
  const client_type: ClientType = input?.client_type === 'company' ? 'company' : 'individual';
  const driver_type: DriverType = input?.driver_type === 'full_time' ? 'full_time' : 'gig';

  const fieldErrors: FieldErrors = {};
  const set = (field: keyof FieldErrors, code: AuthErrorCode | null) => {
    if (code) fieldErrors[field] = code;
  };
  set('full_name', checkName(full_name));
  set('phone', checkPhone(phone));
  set('email', checkEmail(email));
  set('passcode', checkPasscode(passcode));
  if (!city) fieldErrors.city = 'city_required';
  if (role === 'driver') {
    if (!vehicle_type) fieldErrors.vehicle_type = 'vehicle_required';
    set('vehicle_number', checkVehicleNumber(vehicle_number));
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  let failure: AuthResult | null = null;
  let confirmEmail = false;
  try {
    const db = getDb();

    // Check the choices against real rows, and catch duplicates here so the
    // user gets a precise message instead of a generic database error.
    const [cityRow, vehicleRow, clientDupes, driverDupes, plateDupes] = await Promise.all([
      one<City>(db.from('cities').select('*').eq('name', city)),
      role === 'driver' ? one<VehicleType>(db.from('vehicle_types').select('*').eq('id', vehicle_type)) : Promise.resolve(null),
      rows<{ id: string }>(db.from('clients').select('*').eq('email', email).limit(1)),
      rows<{ id: string }>(db.from('drivers').select('*').eq('email', email).limit(1)),
      role === 'driver' && vehicle_number
        ? rows<{ id: string }>(db.from('drivers').select('*').eq('vehicle_number', vehicle_number).limit(1))
        : Promise.resolve([]),
    ]);
    if (!cityRow) fieldErrors.city = 'city_required';
    if (role === 'driver' && !vehicleRow) fieldErrors.vehicle_type = 'vehicle_required';
    if (clientDupes.length || driverDupes.length) fieldErrors.email = 'email_taken';
    if (plateDupes.length) fieldErrors.vehicle_number = 'vehicle_taken';
    if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

    const supabase = await createAuthClient(role);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: passcode,
      options: {
        // Read by the handle_new_user() trigger in supabase/auth.sql.
        data:
          role === 'client'
            ? { role, client_type, full_name, phone, city }
            : { role, driver_type, full_name, phone, city, vehicle_type, vehicle_number },
      },
    });

    if (error) {
      const code = mapAuthError(error);
      failure = code === 'email_taken' ? { ok: false, fieldErrors: { email: code } } : { ok: false, error: code };
    } else if (data.user && data.user.identities && data.user.identities.length === 0) {
      // With email confirmation on, Supabase answers "ok" for an address that is already registered.
      failure = { ok: false, fieldErrors: { email: 'email_taken' } };
    } else if (!data.session) {
      confirmEmail = true;
    } else if (!data.user || !(await hasPortalRow(role, data.user.id))) {
      // Signed up, but the trigger did not create the profile: supabase/auth.sql has not been run.
      await supabase.auth.signOut({ scope: 'local' });
      failure = { ok: false, error: 'profile_missing' };
    }
  } catch {
    failure = { ok: false, error: 'generic' };
  }

  if (failure) return failure;
  if (confirmEmail) return { ok: true, confirmEmail: true };
  redirect(DASHBOARD[role]);
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
export async function logout(role: Role): Promise<void> {
  if (role === 'admin') {
    await endAdminSession();
  } else if (isPortalRole(role) && isAuthConfigured()) {
    try {
      const supabase = await createAuthClient(role);
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Already signed out, or Supabase unreachable: the cookie is cleared either way.
    }
  }
  redirect('/');
}

// ---------------------------------------------------------------------------
// Admin passcode
// ---------------------------------------------------------------------------
export type AdminLoginState = { message: string };

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function adminLogin(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  if (!isSupabaseConfigured()) return { message: 'Supabase is not configured yet.' };
  const expected = process.env.ADMIN_PASSCODE;
  const given = String(formData.get('passcode') ?? '');
  if (expected) {
    if (!sameText(given, expected)) return { message: 'Wrong passcode. / गलत पासकोड।' };
  } else if (process.env.NODE_ENV === 'production') {
    return { message: 'Set the ADMIN_PASSCODE environment variable to enable the admin panel.' };
  }
  const db = getDb();
  const admin = await one<{ id: string; name: string }>(db.from('admins').select('*').limit(1));
  if (!admin) return { message: 'No admin row found. Run supabase/schema.sql first.' };
  await startAdminSession({ id: admin.id, name: admin.name });
  redirect('/admin');
}
