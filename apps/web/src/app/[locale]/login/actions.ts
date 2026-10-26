'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashIp, loginBlockedMinutes, recordLoginAttempt } from '@coach/core';
import { supabaseServer } from '@/lib/supabase/server';

export type SignInState = { error?: 'wrong' | 'blocked' | 'failed'; minutes?: number } | null;

// Server-side sign-in: the session cookies are set httpOnly here (lib/supabase/cookies.ts), and
// failed attempts are rate-limited per IP (5 per 15 minutes, COACH.auth).
export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const h = await headers();
  const ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  let ipHash: string;
  try {
    ipHash = hashIp(ip);
    const wait = await loginBlockedMinutes(ipHash);
    if (wait) return { error: 'blocked', minutes: wait };
  } catch (err) {
    console.error('login limiter unavailable', err);
    return { error: 'failed' };
  }
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
  });
  await recordLoginAttempt(ipHash, !error);
  if (error) {
    const wait = await loginBlockedMinutes(ipHash);
    return wait ? { error: 'blocked', minutes: wait } : { error: 'wrong' };
  }
  redirect('/');
}
