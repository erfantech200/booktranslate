import 'server-only';
import { headers } from 'next/headers';

// Starts a background worker run on this deployment (see app/api/worker/run). The run answers
// immediately and keeps working after the response, so this returns within a second or two.
// Safe to call often: concurrent runs share the queue via SELECT … FOR UPDATE SKIP LOCKED.

async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

export async function kickWorker(origin?: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const base = origin ?? process.env.APP_URL ?? (await requestOrigin());
  if (!secret || !base) return;
  try {
    await fetch(`${base}/api/worker/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        // Vercel Deployment Protection: lets this server-to-server call through when
        // "Protection Bypass for Automation" is enabled (Vercel provides this variable).
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Best effort: the status poll and the daily cron will start a run later.
  }
}
