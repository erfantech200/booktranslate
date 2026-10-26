import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hardenCookie } from './cookies';

/** Supabase client acting as the signed-in user (RLS applies). Never uses the service role. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, hardenCookie(options)));
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes them.
        }
      },
    },
  });
}

/** The current user or null. Uses getUser() (verified with Supabase), not the unverified session. */
export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** Server-side guard for pages, actions and routes (on top of the proxy). */
export async function requireUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect('/login');
  return { sb, user: data.user };
}
