import { COACH } from '@coach/core/shared';

// Session cookies (spec §3): httpOnly (the browser never touches the tokens; all Supabase calls
// run on the server), Secure in production, SameSite=Lax, and a 30-day lifetime that restarts
// whenever the proxy refreshes the session, so regular use never forces a new login.
export function hardenCookie<T extends { maxAge?: number }>(options: T): T {
  const removing = options.maxAge === 0;
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    ...(removing ? {} : { maxAge: COACH.auth.sessionDays * 86_400 }),
  };
}
