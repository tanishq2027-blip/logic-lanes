import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieName, type PortalRole } from '@/lib/supabase/cookies';

/**
 * Guards /client/* and /driver/*.
 *
 * 1. Refreshes the portal's Supabase session and writes the new cookies, which
 *    Server Components cannot do themselves.
 * 2. Sends visitors who are not signed in back to the landing page.
 * 3. Checks the role in `public.profiles` (read with the user's own token, so
 *    RLS applies) and turns away accounts that belong to the other portal.
 *    The role is never taken from user metadata, which users can edit.
 */
export async function middleware(request: NextRequest) {
  const role: PortalRole = request.nextUrl.pathname.startsWith('/driver') ? 'driver' : 'client';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Not configured yet: let the page render its setup screen.
  if (!url || !anon) return NextResponse.next();

  let response = NextResponse.next({ request });
  const refreshed: { name: string; value: string; options: Parameters<typeof response.cookies.set>[2] }[] = [];

  const supabase = createServerClient(url, anon, {
    cookieOptions: { name: authCookieName(role) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          // httpOnly: the session is only ever used server-side (see hardened() in lib/supabase/auth.ts).
          const safe = { ...options, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const };
          response.cookies.set(name, value, safe);
          refreshed.push({ name, value, options: safe });
        }
      },
    },
  });

  const bounce = (reason?: string) => {
    const target = request.nextUrl.clone();
    target.pathname = '/';
    target.search = `?portal=${role}${reason ? `&error=${reason}` : ''}`;
    const redirect = NextResponse.redirect(target);
    // Keep any refreshed session cookies on the redirect as well.
    for (const c of refreshed) redirect.cookies.set(c.name, c.value, c.options);
    return redirect;
  };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return bounce();

  const { data: profiles } = await supabase.from('profiles').select('role').eq('id', data.user.id).limit(1);
  const profileRole = (profiles?.[0] as { role?: string } | undefined)?.role;
  if (profileRole !== role) return bounce('wrong_portal');

  return response;
}

export const config = {
  matcher: ['/client/:path*', '/driver/:path*'],
};
