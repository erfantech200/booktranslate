import { env } from './config';
import { BudgetExceededError } from './openai/structured';
import { claimJobs, completeJob, failJob, heartbeat, nextRunAt, pauseJob, requeueJob, type Job } from './queue';
import { JobYield, PermanentError, runJob, type JobDeps } from './jobs';

export interface RunnerOptions {
  workerId: string;
  leaseSeconds?: number;
  /** Epoch ms after which jobs should yield (serverless). Omit for an unlimited run (tests). */
  deadline?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const defaultLog = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const timeLeftFn = (deadline?: number) => () => (deadline === undefined ? Infinity : deadline - Date.now());

/** Run one claimed job to completion, translating errors into queue state. */
export async function executeJob(job: Job, deps: JobDeps, o: RunnerOptions): Promise<'done' | 'retry' | 'failed' | 'paused' | 'yielded'> {
  const lease = o.leaseSeconds ?? env().JOB_LEASE_SECONDS;
  const log = o.log ?? defaultLog;
  const started = Date.now();
  let lastBeat = Date.now();
  const ctx = {
    job,
    deps,
    timeLeft: timeLeftFn(o.deadline),
    log: (msg: string, extra?: Record<string, unknown>) => log(msg, { job: job.id, type: job.type, ...extra }),
    heartbeat: async () => {
      if (Date.now() - lastBeat < 10_000) return;
      lastBeat = Date.now();
      if (!(await heartbeat(job.id, o.workerId, lease))) throw new Error('lost job lease');
    },
  };
  // Background heartbeat for long single steps (one model call can take a while).
  const timer = setInterval(() => { void heartbeat(job.id, o.workerId, lease).catch(() => {}); }, Math.max(5_000, (lease * 1000) / 3));
  try {
    const result = await runJob(ctx);
    await completeJob(job.id, result);
    log('job done', { job: job.id, type: job.type, ms: Date.now() - started });
    return 'done';
  } catch (err) {
    if (err instanceof JobYield) {
      await requeueJob(job.id);
      log('job yielded (time budget)', { job: job.id, type: job.type, ms: Date.now() - started });
      return 'yielded';
    }
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (err instanceof BudgetExceededError) {
      await pauseJob(job.id, err.message);
      log('job paused (budget)', { job: job.id, type: job.type, error: err.message });
      return 'paused';
    }
    const permanent = err instanceof PermanentError;
    const outcome = await failJob(job, msg, { retryable: !permanent });
    log(outcome === 'retry' ? 'job failed, will retry' : 'job failed', { job: job.id, type: job.type, error: msg, attempt: job.attempts });
    return outcome;
  } finally {
    clearInterval(timer);
  }
}

/**
 * Claim up to `slots` jobs and run them concurrently. Returns how many were claimed, so callers
 * can poll faster while there is work and back off when idle.
 */
export async function runAvailable(deps: JobDeps, slots: number, o: RunnerOptions): Promise<number> {
  const jobs = await claimJobs(o.workerId, slots, o.leaseSeconds ?? env().JOB_LEASE_SECONDS);
  await Promise.all(jobs.map((j) => executeJob(j, deps, o)));
  return jobs.length;
}

/**
 * Serverless run: `lanes` independent loops claim and run one job at a time until the deadline
 * is close (a lane only starts a job with at least `claimMinMs` left). A job due within the
 * remaining time (e.g. a short retry backoff) is waited for. Returns jobs run and whether
 * runnable work is still left, so the caller can start the next run.
 */
export async function runUntil(deps: JobDeps, o: RunnerOptions & { deadline: number; lanes?: number; claimMinMs?: number }): Promise<{ ran: number; moreWork: boolean }> {
  const claimMinMs = o.claimMinMs ?? 120_000;
  const timeLeft = timeLeftFn(o.deadline);
  let ran = 0;
  const lane = async (i: number) => {
    await new Promise((r) => setTimeout(r, i * 200));
    while (timeLeft() > claimMinMs) {
      const n = await runAvailable(deps, 1, o);
      ran += n;
      if (n > 0) continue;
      const next = await nextRunAt();
      const wait = next ? next.getTime() - Date.now() : Infinity;
      if (wait > Math.min(30_000, timeLeft() - claimMinMs)) break;
      await new Promise((r) => setTimeout(r, Math.max(500, wait)));
    }
  };
  await Promise.all(Array.from({ length: o.lanes ?? 3 }, (_, i) => lane(i)));
  const next = await nextRunAt();
  return { ran, moreWork: next !== null && next.getTime() - Date.now() < 60_000 };
}

/** Drain the queue (tests / one-shot CLI): keep claiming until nothing runnable is left. */
export async function drain(deps: JobDeps, o: RunnerOptions & { slots?: number; maxRounds?: number }): Promise<number> {
  let total = 0;
  for (let round = 0; round < (o.maxRounds ?? 500); round++) {
    const n = await runAvailable(deps, o.slots ?? 4, o);
    total += n;
    if (n === 0) break;
  }
  return total;
}
