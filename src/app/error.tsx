'use client';

import Link from 'next/link';

/** Last line of defence: any unexpected render error lands here instead of a blank screen. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <div className="card">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-2 text-3xl font-black">This page hit a problem</h1>
        <p className="mt-3 text-lg font-semibold text-noir/75">Your data is safe. Try again, or go back to the home page.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
