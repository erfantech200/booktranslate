import { after, NextResponse, type NextRequest } from 'next/server';
import { runWorker } from '@/lib/workerRun';

// Vercel function limit: one run works for up to ~280 s, then hands over to the next run.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Starts a worker run. Called by the app itself (kickWorker) and by the daily Vercel cron,
 * both with `Authorization: Bearer $CRON_SECRET`. Responds at once; the work continues in after().
 */
async function handle(req: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  after(() => runWorker(origin, startedAt));
  return NextResponse.json({ started: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
