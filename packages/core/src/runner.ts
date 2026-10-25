import { env } from './config';
import { BudgetExceededError } from './openai/structured';
import { claimJobs, completeJob, failJob, heartbeat, pauseJob, type Job } from './queue';
import { markJobFailure, PermanentError, runJob, type PipelineDeps } from './pipeline/index';

export interface RunnerOptions {
  workerId: string;
  leaseSeconds?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const defaultLog = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/** Run one claimed job to completion, translating errors into queue state. */
export async function executeJob(job: Job, deps: PipelineDeps, o: RunnerOptions): Promise<'done' | 'retry' | 'failed' | 'paused'> {
  const lease = o.leaseSeconds ?? env().JOB_LEASE_SECONDS;
  const log = o.log ?? defaultLog;
  const started = Date.now();
  let lastBeat = Date.now();
  const ctx = {
    job,
    deps,
    log: (msg: string, extra?: Record<string, unknown>) => log(msg, { job: job.id, type: job.type, ...extra }),
    heartbeat: async () => {
      if (Date.now() - lastBeat < 10_000) return;
      lastBeat = Date.now();
      if (!(await heartbeat(job.id, o.workerId, lease))) throw new Error('lost job lease');
    },
  };
  // Background heartbeat for long single steps (one OCR call can take a while).
  const timer = setInterval(() => { void heartbeat(job.id, o.workerId, lease).catch(() => {}); }, Math.max(5_000, (lease * 1000) / 3));
  try {
    const result = await runJob(ctx);
    await completeJob(job.id, result);
    log('job done', { job: job.id, type: job.type, ms: Date.now() - started });
    return 'done';
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (err instanceof BudgetExceededError) {
      await pauseJob(job.id, err.message);
      await markJobFailure(job.type, job.payload, err.message, 'paused');
      log('job paused (budget)', { job: job.id, type: job.type, error: err.message });
      return 'paused';
    }
    const permanent = err instanceof PermanentError;
    const outcome = await failJob(job, msg, { retryable: !permanent });
    if (outcome === 'failed') await markJobFailure(job.type, job.payload, permanent ? (err as Error).message : msg, 'error');
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
export async function runAvailable(deps: PipelineDeps, slots: number, o: RunnerOptions): Promise<number> {
  const jobs = await claimJobs(o.workerId, slots, o.leaseSeconds ?? env().JOB_LEASE_SECONDS);
  await Promise.all(jobs.map((j) => executeJob(j, deps, o)));
  return jobs.length;
}

/** Drain the queue (tests / one-shot CLI): keep claiming until nothing runnable is left. */
export async function drain(deps: PipelineDeps, o: RunnerOptions & { slots?: number; maxRounds?: number }): Promise<number> {
  let total = 0;
  for (let round = 0; round < (o.maxRounds ?? 500); round++) {
    const n = await runAvailable(deps, o.slots ?? 4, o);
    total += n;
    if (n === 0) break;
  }
  return total;
}
