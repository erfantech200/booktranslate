import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createIntlMiddleware(routing);
const PUBLIC = [/^\/(en\/)?login\/?$/, /^\/(fa\/)?login\/?$/];

/**
 * 1) next-intl locale routing, 2) refresh the Supabase session cookie, 3) redirect anonymous
 * visitors to /login. Whether the account is allowed is decided by the database (allowlist +
 * RLS) and by the OAuth callback, not here.
 */
export async function proxy(req: NextRequest) {
  const res = req.nextUrl.pathname.startsWith('/api') || req.nextUrl.pathname.startsWith('/auth')
    ? NextResponse.next({ request: req })
    : intl(req);

  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  const { data } = await sb.auth.getUser();

  const path = req.nextUrl.pathname;
  // /api/worker/* authenticates with CRON_SECRET itself (called by the cron and by the app).
  const isPublic = PUBLIC.some((r) => r.test(path)) || path.startsWith('/auth') || path.startsWith('/api/worker/');
  if (!data.user && !isPublic) {
    if (path.startsWith('/api')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const url = req.nextUrl.clone();
    const locale = path.startsWith('/en') ? '/en' : '';
    url.pathname = `${locale}/login`;
    url.search = '';
    const redirect = NextResponse.redirect(url);
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return res;
}

export const config = {
  // Skip static files and Next internals.
  matcher: ['/((?!_next|favicon.ico|manifest.webmanifest|icons|.*\\.(?:png|jpg|svg|webp|woff2|ico|txt)$).*)'],
};
