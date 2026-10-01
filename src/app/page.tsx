import { AuthCard, type VehicleOption } from '@/components/auth/AuthCard';
import { AuthPortals } from '@/components/auth/AuthPortals';
import { BackgroundVideo } from '@/components/BackgroundVideo';
import { HiddenAdminTrigger } from '@/components/HiddenAdminTrigger';
import { Logo } from '@/components/Logo';
import { FadeIn } from '@/components/Motion';
import { isAuthErrorCode, type AuthErrorCode } from '@/lib/authMessages';
import { rows } from '@/lib/data';
import { getSession } from '@/lib/session';
import { isAuthConfigured } from '@/lib/supabase/auth';
import type { PortalRole } from '@/lib/supabase/cookies';
import { getDb, isSupabaseConfigured } from '@/lib/supabase/server';
import type { City, VehicleType } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Search = Promise<{ portal?: string; error?: string }>;

export default async function LandingPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const portal: PortalRole = params.portal === 'driver' ? 'driver' : 'client';
  const error: AuthErrorCode | null = isAuthErrorCode(params.error) ? params.error : null;
  const ready = isSupabaseConfigured() && isAuthConfigured();

  // The register forms offer real cities and vehicle classes from the database.
  let cities: string[] = [];
  let vehicles: VehicleOption[] = [];
  let clientName: string | null = null;
  let driverName: string | null = null;
  let reachable = ready;
  if (ready) {
    try {
      const db = getDb();
      const [cityRows, vehicleRows, client, driver] = await Promise.all([
        rows<City>(db.from('cities').select('*').order('name')),
        rows<VehicleType>(db.from('vehicle_types').select('*').order('capacity_kg')),
        getSession('client'),
        getSession('driver'),
      ]);
      cities = cityRows.map((c) => c.name);
      vehicles = vehicleRows.map((v) => ({ id: v.id, name: v.name, capacity_kg: v.capacity_kg }));
      clientName = client?.name ?? null;
      driverName = driver?.name ?? null;
    } catch {
      // Database unreachable or schema not installed: the cards explain what to do.
      reachable = false;
    }
  }

  return (
    // `isolate` keeps the background video (z-index below zero) inside this page, above the body's own background.
    <div className="on-video relative isolate flex min-h-screen flex-col">
      <BackgroundVideo src="/landing-bg.mp4?v=2" />
      <header className="shell flex items-center py-6 sm:py-8">
        <Logo size={40} />
      </header>

      {/* Split entry: the promise on the left, the two portals on the right.
          Below 1280px the headline sits on top and the portals take the full width. */}
      <main className="shell flex-1 pb-16 pt-4 sm:pb-24 sm:pt-8">
        <div className="grid items-start gap-12 xl:grid-cols-[minmax(0,5fr)_minmax(0,9fr)] xl:gap-16">
          <FadeIn className="xl:sticky xl:top-16 xl:pt-10">
            <p className="eyebrow">Freight across India</p>
            <h1 className="mt-5 text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl xl:text-7xl">
              Every truck full.
              <br />
              Every route smart.
            </h1>
          </FadeIn>

          <FadeIn delay={0.08}>
            <AuthPortals
              initial={portal}
              client={
                <AuthCard
                  role="client"
                  cities={cities}
                  vehicles={vehicles}
                  ready={reachable}
                  signedInAs={clientName}
                  initialError={portal === 'client' ? error : null}
                />
              }
              driver={
                <AuthCard
                  role="driver"
                  cities={cities}
                  vehicles={vehicles}
                  ready={reachable}
                  signedInAs={driverName}
                  initialError={portal === 'driver' ? error : null}
                />
              }
            />
          </FadeIn>
        </div>
      </main>

      <footer className="border-t border-white/60 bg-white/50 backdrop-blur-md">
        <div className="shell flex flex-col items-start justify-between gap-2 py-3 sm:flex-row sm:items-center">
          {/* Triple-click this logo, or press Ctrl + Shift + A, to reach the admin console. */}
          <HiddenAdminTrigger />
          <p className="text-sm font-bold text-noir/85">Made by Team Torvalds</p>
        </div>
      </footer>
    </div>
  );
}
