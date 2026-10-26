import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createIntlMiddleware(routing);
const PUBLIC = [/^\/login\/?$/];

// NEXT_PUBLIC_* values are baked in at build time: if they were missing when Vercel built the
// site, every request would crash with a bare "Internal Server Error". Show what to fix instead.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
function configProblem(): string | null {
  if (!SUPABASE_URL) return 'The Supabase URL is not set (SUPABASE_URL)';
  if (!/^https:\/\/[^/\s]+\/?$/.test(SUPABASE_URL)) return 'SUPABASE_URL must look like https://xxxx.supabase.co (nothing after it)';
  if (!SUPABASE_ANON_KEY) return 'The Supabase publishable key is not set (SUPABASE_PUBLISHABLE_KEY)';
  return null;
}
function setupPage(problem: string) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup needed</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>Setup needed</h1><p><b>${problem}</b>.</p>
<p>In Vercel: <i>Settings → Environment Variables</i>, add or fix it for the <b>Production</b> environment,
then <i>Deployments → ⋯ → Redeploy</i>. These values are read when the site is built, so a redeploy is required.</p>
<p dir="rtl" lang="fa" style="font-family:Tahoma,sans-serif">تنظیمات ناقص است. در Vercel این متغیر را برای Production اضافه یا اصلاح کنید و سپس Redeploy بزنید.</p></body>`;
  return new NextResponse(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * 1) next-intl routing, 2) refresh the Supabase session cookie, 3) send anonymous visitors to
 * /login and answer 401 on APIs. Data access is additionally limited to the owner's rows by RLS.
 */
export async function proxy(req: NextRequest) {
  const path0 = req.nextUrl.pathname;
  // Diagnostics must work even when the configuration is broken.
  if (path0 === '/api/health') return NextResponse.next({ request: req });
  const problem = configProblem();
  if (problem) return setupPage(problem);

  const res = req.nextUrl.pathname.startsWith('/api') ? NextResponse.next({ request: req }) : intl(req);

  const sb = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  // A Supabase outage or a wrong key must not take every page down: treat it as signed out.
  const user = await sb.auth.getUser().then((r) => r.data.user, () => null);

  const path = req.nextUrl.pathname;
  // /api/worker/* and /api/admin/* authenticate with CRON_SECRET themselves.
  const isPublic = PUBLIC.some((r) => r.test(path)) || path.startsWith('/api/worker/') || path.startsWith('/api/admin/');
  if (!user && !isPublic) {
    if (path.startsWith('/api')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
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
