'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { adminLogin, type AdminLoginState } from '@/app/actions/auth';
import { Icon } from '../Icon';
import { Logo } from '../Logo';

const initial: AdminLoginState = { message: '' };

export function AdminGate({ passcodeSet }: { passcodeSet: boolean }) {
  const [state, action, pending] = useActionState(adminLogin, initial);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Logo />
      <form action={action} className="card mt-10 space-y-6">
        <div>
          <p className="eyebrow">Restricted</p>
          <h1 className="mt-1 text-3xl font-black">Control room</h1>
        </div>
        <div>
          <label htmlFor="passcode" className="label">
            Passcode
          </label>
          <input id="passcode" name="passcode" type="password" autoComplete="off" className="field" required={passcodeSet} autoFocus />
          {passcodeSet ? null : (
            <p className="mt-2 text-sm font-bold text-noir/65">
              No ADMIN_PASSCODE is set. In development the panel opens without one; in production it stays locked until you set it.
            </p>
          )}
        </div>
        {state.message ? (
          <p role="alert" className="rounded-xl bg-noir px-4 py-3 font-bold text-pearl">
            {state.message}
          </p>
        ) : null}
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          <Icon name="shield" size={20} />
          {pending ? 'Checking…' : 'Open admin panel'}
        </button>
        <Link href="/" className="btn-secondary w-full">
          Back to home
        </Link>
      </form>
    </main>
  );
}
