import { createHmac } from 'node:crypto';
import { COACH } from './coach.config';
import { maybeOne, query } from './db/pool';

// Sign-in rate limiting per IP (service role, table login_attempts). The IP is stored only as an
// HMAC with a server secret, so the table never holds raw addresses.

export function hashIp(ip: string, secret = process.env.CRON_SECRET ?? ''): string {
  if (!secret) throw new Error('CRON_SECRET is needed to hash login IPs');
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/** Minutes until the IP may try again, or 0 when it isn't blocked. */
export async function loginBlockedMinutes(ipHash: string): Promise<number> {
  const { maxFailures, windowMinutes } = COACH.auth;
  const r = await maybeOne<{ n: number; oldest: Date | null }>(
    `select count(*)::int as n, min(created_at) as oldest from (
       select created_at from public.login_attempts
       where ip_hash = $1 and not ok and created_at > now() - make_interval(mins => $2)
       order by created_at desc limit $3) recent`,
    [ipHash, windowMinutes, maxFailures],
  );
  if (!r || r.n < maxFailures || !r.oldest) return 0;
  const freeAt = r.oldest.getTime() + windowMinutes * 60_000;
  return Math.max(1, Math.ceil((freeAt - Date.now()) / 60_000));
}

export async function recordLoginAttempt(ipHash: string, ok: boolean): Promise<void> {
  await query('insert into public.login_attempts (ip_hash, ok) values ($1, $2)', [ipHash, ok]);
  // A successful sign-in clears the slate for this IP; old rows are pruned as we go.
  if (ok) await query('delete from public.login_attempts where ip_hash = $1 and not ok', [ipHash]);
  await query(`delete from public.login_attempts where created_at < now() - interval '2 days'`);
}
