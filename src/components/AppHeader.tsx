import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import type { Role } from '@/lib/types';
import { Icon } from './Icon';
import { Logo } from './Logo';

/** Midnight top bar shared by the three portals. */
export function AppHeader({ name, role, session }: { name: string; role: string; session: Role }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-midnight/70 text-pearl backdrop-blur-md">
      <div className="shell flex items-center justify-between gap-4 py-3.5">
        <Link href="/" aria-label="Logic Lanes home" className="rounded-lg">
          <Logo onDark size={34} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <p className="font-extrabold">{name}</p>
            <p className="text-sm text-pearl/75">{role}</p>
          </div>
          <form action={logout.bind(null, session)}>
            <button
              type="submit"
              className="inline-flex min-h-touch items-center gap-2 rounded-2xl border border-pearl/60 px-5 py-2 font-extrabold text-pearl transition-colors hover:bg-pearl hover:text-midnight"
            >
              <Icon name="logout" size={20} />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
