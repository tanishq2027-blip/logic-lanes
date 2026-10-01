import Link from 'next/link';
import { Icon } from './Icon';

/** Shown instead of a data page while Supabase is not connected, or when a query fails. */
export function SetupNotice({ error }: { error?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
      <div className="card">
        <p className="eyebrow">Setup needed</p>
        <h1 className="mt-2 text-3xl font-black">{error ? 'The database did not answer' : 'Connect Supabase to continue'}</h1>
        {error ? (
          <p className="mt-3 rounded-xl border border-noir/15 bg-noir px-4 py-3 font-bold text-pearl">{error}</p>
        ) : null}
        <ol className="mt-5 space-y-3 text-base font-semibold">
          <li className="flex gap-3">
            <span className="chip-solid h-8 shrink-0">1</span>
            <span>
              Open the Supabase SQL Editor, paste <code className="font-black">supabase/schema.sql</code> and run it.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip-solid h-8 shrink-0">2</span>
            <span>
              Copy <code className="font-black">.env.example</code> to <code className="font-black">.env.local</code> and fill in the three
              Supabase keys.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip-solid h-8 shrink-0">3</span>
            <span>Restart the dev server and reload this page.</span>
          </li>
        </ol>
        <Link href="/" className="btn-secondary mt-6">
          <Icon name="back" size={20} /> Back to home
        </Link>
      </div>
    </main>
  );
}
