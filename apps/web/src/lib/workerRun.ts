import 'server-only';
import { randomUUID } from 'node:crypto';
import { dbCallHooks, OpenAITransport, runUntil, SupabaseStorage, type JobDeps } from '@coach/core';
import { kickWorker } from './kick';

// The background worker, running inside a Vercel function. Each run works until its time budget
// is nearly used (long jobs save progress and yield), then starts the next run if work is left.

let deps: JobDeps | null = null;
function getDeps(): JobDeps {
  deps ??= { storage: new SupabaseStorage(), transport: new OpenAITransport(), hooks: dbCallHooks };
  return deps;
}

export async function runWorker(origin: string, startedAt: number) {
  const budgetMs = Number(process.env.WORKER_TIME_BUDGET_SECONDS ?? 280) * 1000;
  const workerId = `vercel:${randomUUID().slice(0, 8)}`;
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), worker: workerId, msg, ...extra }));
  try {
    const r = await runUntil(getDeps(), {
      workerId,
      deadline: startedAt + budgetMs,
      lanes: Number(process.env.WORKER_CONCURRENCY ?? 3),
      claimMinMs: Number(process.env.WORKER_CLAIM_MIN_SECONDS ?? 120) * 1000,
      // Longer than the function's max duration: if Vercel stops this run, its jobs are
      // re-claimed by a later run once the lease expires.
      leaseSeconds: 330,
      log,
    });
    log('worker run finished', { ran: r.ran, moreWork: r.moreWork, ms: Date.now() - startedAt });
    if (r.moreWork) await kickWorker(origin);
  } catch (err) {
    log('worker run crashed', { error: err instanceof Error ? err.stack : String(err) });
  }
}
