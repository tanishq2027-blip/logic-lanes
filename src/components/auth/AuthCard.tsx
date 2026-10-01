'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { logout, signIn, signUp } from '@/app/actions/auth';
import {
  AUTH_SUCCESS,
  MIN_PASSCODE_LENGTH,
  bilingual,
  checkEmail,
  checkName,
  checkPasscode,
  checkPhone,
  checkVehicleNumber,
  type AuthErrorCode,
  type AuthField,
  type ClientType,
  type DriverType,
  type FieldErrors,
} from '@/lib/authMessages';
import { describeActionFailure } from '@/lib/actionError';
import { DASHBOARD, type PortalRole } from '@/lib/supabase/cookies';
import { Icon, type IconName } from '../Icon';

type Mode = 'login' | 'register';
export type VehicleOption = { id: string; name: string; capacity_kg: number };

type Props = {
  role: PortalRole;
  cities: string[];
  vehicles: VehicleOption[];
  /** False while Supabase is not configured: the card explains instead of offering a form that cannot work. */
  ready: boolean;
  /** Name of the account already signed in to this portal on this browser, if any. */
  signedInAs?: string | null;
  initialError?: AuthErrorCode | null;
};

const COPY: Record<PortalRole, { eyebrow: string; title: string; icon: IconName; cta: string }> = {
  client: {
    eyebrow: 'Client portal',
    title: 'Ship Cargo',
    icon: 'box',
    cta: 'Open my dashboard',
  },
  driver: {
    eyebrow: 'Employee / driver portal',
    title: 'Fleet Partner',
    icon: 'truck',
    cta: 'Open my Job Card',
  },
};

const CLIENT_TYPES: { value: ClientType; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'company', label: 'Company / Business' },
];

const DRIVER_TYPES: { value: DriverType; label: string }[] = [
  { value: 'gig', label: 'Gig Transporter' },
  { value: 'full_time', label: 'Full-Time Fleet Employee' },
];

const EMPTY = { full_name: '', phone: '', email: '', passcode: '', city: '', vehicle_type: '', vehicle_number: '' };
type Values = typeof EMPTY;

/**
 * Sign-in / sign-up card for one portal. Login and Register live on two tabs;
 * fields validate as you leave them and again on the server, and every error
 * is shown in English and Hindi.
 */
export function AuthCard({ role, cities, vehicles, ready, signedInAs, initialError }: Props) {
  const copy = COPY[role];
  const uid = useId();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>('login');
  const [values, setValues] = useState<Values>(EMPTY);
  const [clientType, setClientType] = useState<ClientType>('individual');
  const [driverType, setDriverType] = useState<DriverType>('gig');
  const [touched, setTouched] = useState<Partial<Record<AuthField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<AuthErrorCode | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPasscode, setShowPasscode] = useState(false);
  const [pending, startTransition] = useTransition();

  const registering = mode === 'register';

  /** Client-side rule for one field in the current mode. */
  function check(field: AuthField, v: Values = values): AuthErrorCode | null {
    switch (field) {
      case 'email':
        return checkEmail(v.email);
      case 'passcode':
        // Logging in only needs a passcode to be present; the length rule is for new ones.
        return registering ? checkPasscode(v.passcode) : v.passcode ? null : 'passcode_short';
      case 'full_name':
        return registering ? checkName(v.full_name) : null;
      case 'phone':
        return registering ? checkPhone(v.phone) : null;
      case 'city':
        return registering && !v.city ? 'city_required' : null;
      case 'vehicle_type':
        return registering && role === 'driver' && !v.vehicle_type ? 'vehicle_required' : null;
      case 'vehicle_number':
        return registering && role === 'driver' ? checkVehicleNumber(v.vehicle_number) : null;
    }
  }

  const activeFields: AuthField[] = registering
    ? role === 'driver'
      ? ['full_name', 'phone', 'city', 'vehicle_type', 'vehicle_number', 'email', 'passcode']
      : ['full_name', 'phone', 'city', 'email', 'passcode']
    : ['email', 'passcode'];

  const errorFor = (field: AuthField): AuthErrorCode | null => serverErrors[field] ?? (touched[field] ? check(field) : null);

  function update(field: AuthField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (serverErrors[field]) setServerErrors((e) => ({ ...e, [field]: undefined }));
    if (formError) setFormError(null);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setTouched({});
    setServerErrors({});
    setFormError(null);
    setNotice(null);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    setFormError(null);
    setServerErrors({});
    setTouched(Object.fromEntries(activeFields.map((f) => [f, true])));
    const firstBad = activeFields.find((f) => check(f));
    if (firstBad) {
      document.getElementById(`${uid}-${firstBad}`)?.focus();
      return;
    }

    startTransition(async () => {
      let result;
      try {
        result = registering
          ? await signUp(role, {
              full_name: values.full_name,
              phone: values.phone,
              email: values.email,
              passcode: values.passcode,
              city: values.city,
              ...(role === 'client'
                ? { client_type: clientType }
                : { driver_type: driverType, vehicle_type: values.vehicle_type, vehicle_number: values.vehicle_number }),
            })
          : await signIn(role, { email: values.email, passcode: values.passcode });
      } catch {
        // The call never reached the server action. If we are online, this page is older than
        // the running app (it was rebuilt or restarted): reload to pick up the current version.
        if (describeActionFailure().stale) {
          window.location.reload();
          return;
        }
        result = { ok: false, error: 'generic' as const };
      }
      // On success the action redirects to the dashboard and nothing comes back.
      if (!result) return;
      if (result.ok && result.confirmEmail) {
        setNotice(`${AUTH_SUCCESS.confirm_email.en} / ${AUTH_SUCCESS.confirm_email.hi}`);
        setMode('login');
        setValues((v) => ({ ...v, passcode: '' }));
        setTouched({});
        return;
      }
      if (result.fieldErrors) {
        setServerErrors(result.fieldErrors);
        const first = activeFields.find((f) => result.fieldErrors?.[f]);
        if (first) document.getElementById(`${uid}-${first}`)?.focus();
      }
      if (result.error) setFormError(result.error);
    });
  }

  const nameLabel = role === 'client' && clientType === 'company' ? 'Company name' : 'Full name';

  return (
    <section className="card flex h-full flex-col" aria-labelledby={`${uid}-title`}>
      <header className="flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-midnight text-pearl">
          <Icon name={copy.icon} size={30} />
        </span>
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id={`${uid}-title`} className="text-3xl font-black leading-tight">
            {copy.title}
          </h2>
        </div>
      </header>

      {!ready ? (
        <p className="mt-6 rounded-2xl border border-dashed border-noir/30 p-4 font-bold">
          {bilingual('not_configured')}. Add the Supabase keys to <code className="font-black">.env.local</code> and run{' '}
          <code className="font-black">supabase/schema.sql</code> then <code className="font-black">supabase/auth.sql</code>.
        </p>
      ) : signedInAs ? (
        <div className="mt-8 flex flex-1 flex-col justify-center gap-4">
          <p className="rounded-2xl border border-noir/15 p-4 text-lg font-bold">
            Signed in as <span className="font-black">{signedInAs}</span>
          </p>
          <Link href={DASHBOARD[role]} className="btn-primary py-4 text-lg">
            {copy.cta}
            <Icon name="arrow" size={22} />
          </Link>
          <form action={logout.bind(null, role)}>
            <button type="submit" className="btn-secondary w-full">
              <Icon name="logout" size={20} />
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Login / Register tabs */}
          <div role="tablist" aria-label={`${copy.title}: log in or register`} className="mt-8 grid grid-cols-2 gap-1 rounded-2xl border border-noir/10 bg-white/30 p-1.5">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                id={`${uid}-tab-${m}`}
                aria-selected={mode === m}
                aria-controls={`${uid}-panel`}
                onClick={() => switchMode(m)}
                className={`min-h-touch rounded-xl px-4 py-2.5 text-lg font-extrabold transition-colors duration-200 ${
                  mode === m ? 'bg-midnight text-pearl' : 'text-noir hover:bg-midnight/10'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Register'}
              </button>
            ))}
          </div>

          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${mode}`} className="mt-7 flex-1 overflow-hidden">
            {/* Keyed by tab: the new form mounts at once and slides in. Nothing waits on an exit
                animation, so the tabs still work when the browser is not painting frames. */}
            <motion.form
              key={mode}
              onSubmit={onSubmit}
              noValidate
              className="space-y-5"
              initial={reduce ? false : { opacity: 0, x: registering ? 18 : -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {notice ? (
                <p role="status" className="flex items-start gap-2 rounded-2xl border border-noir/15 bg-midnight p-4 font-bold text-pearl">
                  <Icon name="check" size={22} className="mt-0.5 shrink-0" />
                  {notice}
                </p>
              ) : null}

              {registering ? (
                <>
                  {role === 'client' ? (
                    <TypePicker
                      legend="I am shipping as"
                      name={`${uid}-client-type`}
                      options={CLIENT_TYPES}
                      value={clientType}
                      onChange={setClientType}
                    />
                  ) : null}

                  <Field id={`${uid}-full_name`} label={nameLabel} error={errorFor('full_name')}>
                    {(a) => (
                      <input
                        {...a}
                        type="text"
                        autoComplete={role === 'client' && clientType === 'company' ? 'organization' : 'name'}
                        className="field"
                        value={values.full_name}
                        onChange={(e) => update('full_name', e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, full_name: true }))}
                      />
                    )}
                  </Field>

                  <Field id={`${uid}-phone`} label="Mobile number" error={errorFor('phone')}>
                    {(a) => (
                      <input
                        {...a}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="98200 11001"
                        className="field"
                        value={values.phone}
                        onChange={(e) => update('phone', e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                      />
                    )}
                  </Field>

                  <Field id={`${uid}-city`} label={role === 'driver' ? 'Home city' : 'City'} error={errorFor('city')}>
                    {(a) => (
                      <select
                        {...a}
                        className="field"
                        value={values.city}
                        onChange={(e) => update('city', e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, city: true }))}
                      >
                        <option value="" disabled>
                          Choose a city
                        </option>
                        {cities.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  {role === 'driver' ? (
                    <>
                      <Field id={`${uid}-vehicle_type`} label="Vehicle category" error={errorFor('vehicle_type')}>
                        {(a) => (
                          <select
                            {...a}
                            className="field"
                            value={values.vehicle_type}
                            onChange={(e) => update('vehicle_type', e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, vehicle_type: true }))}
                          >
                            <option value="" disabled>
                              Choose your vehicle
                            </option>
                            {vehicles.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} · up to {v.capacity_kg.toLocaleString('en-IN')} kg
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>

                      <Field id={`${uid}-vehicle_number`} label="Vehicle number (optional)" error={errorFor('vehicle_number')}>
                        {(a) => (
                          <input
                            {...a}
                            type="text"
                            autoCapitalize="characters"
                            placeholder="MH 12 AB 1234"
                            className="field uppercase placeholder:normal-case"
                            value={values.vehicle_number}
                            onChange={(e) => update('vehicle_number', e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, vehicle_number: true }))}
                          />
                        )}
                      </Field>

                      <TypePicker
                        legend="How do you want to work?"
                        name={`${uid}-driver-type`}
                        options={DRIVER_TYPES}
                        value={driverType}
                        onChange={setDriverType}
                      />
                    </>
                  ) : null}
                </>
              ) : null}

              <Field id={`${uid}-email`} label={role === 'driver' && !registering ? 'Registered driver email' : 'Email'} error={errorFor('email')}>
                {(a) => (
                  <input
                    {...a}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="field"
                    value={values.email}
                    onChange={(e) => update('email', e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  />
                )}
              </Field>

              <Field
                id={`${uid}-passcode`}
                label="Passcode"
                hint={registering ? `At least ${MIN_PASSCODE_LENGTH} characters` : undefined}
                error={errorFor('passcode')}
              >
                {(a) => (
                  <div className="relative">
                    <input
                      {...a}
                      type={showPasscode ? 'text' : 'password'}
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      className="field pr-24"
                      value={values.passcode}
                      onChange={(e) => update('passcode', e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, passcode: true }))}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasscode((s) => !s)}
                      aria-pressed={showPasscode}
                      aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                      className="absolute inset-y-0 right-0 flex min-w-touch items-center justify-center rounded-r-xl px-4 text-sm font-extrabold text-midnight"
                    >
                      {showPasscode ? 'Hide' : 'Show'}
                    </button>
                  </div>
                )}
              </Field>

              {formError ? (
                <p role="alert" className="flex items-start gap-2 rounded-2xl bg-noir p-4 font-bold text-pearl">
                  <Icon name="alert" size={22} className="mt-0.5 shrink-0" />
                  {bilingual(formError)}
                </p>
              ) : null}

              <button type="submit" className="btn-primary w-full py-4 text-lg" disabled={pending} aria-busy={pending}>
                {pending ? <Spinner /> : <Icon name={registering ? 'user' : 'arrow'} size={22} />}
                {pending ? (registering ? 'Creating your account…' : 'Logging in…') : registering ? 'Create account' : 'Log in'}
              </button>

            </motion.form>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
type InputAria = { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined };

/** Label + control + inline bilingual error. The control receives the ids it needs for screen readers. */
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error: AuthErrorCode | null;
  children: (aria: InputAria) => ReactNode;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={error ? '[&_.field]:border-2 [&_.field]:border-noir [&_.field]:bg-white' : ''}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm font-bold text-noir/65">
          {hint}
        </p>
      ) : null}
      {error ? (
        <motion.p
          id={`${id}-error`}
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="mt-1.5 flex items-start gap-1.5 font-extrabold text-noir"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{bilingual(error)}</span>
        </motion.p>
      ) : null}
    </div>
  );
}

/** Two-option segmented control built on radio inputs, so it works with the keyboard and screen readers. */
function TypePicker<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <label
              key={o.value}
              className={`flex min-h-touch cursor-pointer flex-col justify-center rounded-2xl border px-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-midnight ${
                active ? 'border-midnight bg-midnight text-pearl' : 'border-noir/35 bg-white/40 text-noir hover:border-midnight'
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
              <span className="flex items-center gap-2 font-extrabold leading-tight">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-pearl' : 'border-noir'}`}
                >
                  {active ? <span className="h-2.5 w-2.5 rounded-full bg-pearl" /> : null}
                </span>
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
