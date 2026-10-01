import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <div className="card">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 text-3xl font-black">Page not found</h1>
        <p className="mt-3 text-lg font-semibold text-noir/75">That address does not exist.</p>
        <Link href="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    </main>
  );
}
