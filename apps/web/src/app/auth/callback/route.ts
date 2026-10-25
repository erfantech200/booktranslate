import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** OAuth (PKCE) callback. Only allowlisted accounts keep their session. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const sb = await supabaseServer();
  if (!code) return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/login?error=auth', url.origin));

  const { data: allowed } = await sb.rpc('is_allowed');
  if (allowed !== true) {
    await sb.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=not_allowed', url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
