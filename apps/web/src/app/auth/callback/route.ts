import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Email-link callback (password recovery, invites). Supports both link styles Supabase sends:
 * `?code=` (PKCE, when the reset was requested from this site) and `?token_hash=&type=`
 * (custom email templates). Only allowlisted accounts keep their session.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const sb = await supabaseServer();

  let error: unknown = null;
  if (code) error = (await sb.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) error = (await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  else return NextResponse.redirect(new URL('/login?error=link', url.origin));
  if (error) return NextResponse.redirect(new URL('/login?error=link', url.origin));

  const { data: allowed } = await sb.rpc('is_allowed');
  if (allowed !== true) {
    await sb.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=not_allowed', url.origin));
  }
  // A recovery link always leads to the "set a new password" page.
  return NextResponse.redirect(new URL(type === 'recovery' ? '/reset-password' : safeNext, url.origin));
}
