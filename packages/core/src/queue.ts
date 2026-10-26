import { query, maybeOne, tx, type Queryable } from './db/pool';

export interface Job {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'paused' | 'cancelled';
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_until: Date | null;
  locked_by: string | null;
}

export interface EnqueueOpts {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  /** One live job per key; a duplicate enqueue is a no-op. */
  dedupeKey?: string;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Idempotent enqueue: if a live job with the same dedupe key exists, nothing is inserted. */
export async function enqueue(o: EnqueueOpts, client?: Queryable): Promise<string | null> {
  const row = await maybeOne<{ id: string }>(
    `insert into public.jobs (user_id, type, payload, dedupe_key, priority, run_after, max_attempts)
     values ($1, $2, $3, $4, $5, coalesce($6, now()), $7)
     on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running','paused')
     do nothing
     returning id`,
    [o.userId, o.type, JSON.stringify(o.payload), o.dedupeKey ?? null,
     o.priority ?? 0, o.runAfter ?? null, o.maxAttempts ?? 5],
    client,
  );
  return row?.id ?? null;
}

/**
 * Claim up to `limit` runnable jobs. `SELECT … FOR UPDATE SKIP LOCKED` runs inside a short
 * transaction that flips the rows to `running` with a lease. The job itself then runs outside
 * any transaction, because holding one open for minutes through a transaction pooler is not
 * viable. Expired leases (crashed worker) count as runnable again.
 */
export async function claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]> {
  if (limit <= 0) return [];
  return tx(async (c) => {
    const rows = await query<Job>(
      `select * from public.jobs
       where (status = 'queued' and run_after <= now())
          or (status = 'running' and locked_until < now())
       order by priority desc, run_after asc
       limit $1
       for update skip locked`,
      [limit],
      c,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    return query<Job>(
      `update public.jobs
       set status = 'running', attempts = attempts + 1, locked_by = $2,
           locked_until = now() + make_interval(secs => $3)
       where id = any($1::uuid[])
       returning *`,
      [ids, workerId, leaseSeconds],
      c,
    );
  });
}

export async function heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
  const rows = await query(
    `update public.jobs set locked_until = now() + make_interval(secs => $3)
     where id = $1 and locked_by = $2 and status = 'running' returning id`,
    [jobId, workerId, leaseSeconds],
  );
  return rows.length > 0;
}

export async function completeJob(jobId: string, result?: unknown): Promise<void> {
  await query(
    `update public.jobs set status = 'done', result = $2, locked_until = null, finished_at = now(),
            last_error = null
     where id = $1`,
    [jobId, result === undefined ? null : JSON.stringify(result)],
  );
}

/** Exponential backoff: 15s, 60s, 4m, 16m, … capped at 1h, with ±20% jitter. */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(3600, 15 * 4 ** Math.max(0, attempt - 1));
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export async function failJob(job: Pick<Job, 'id' | 'attempts' | 'max_attempts'>, error: string,
  opts: { retryable?: boolean; delaySeconds?: number } = {}): Promise<'retry' | 'failed'> {
  const retry = (opts.retryable ?? true) && job.attempts < job.max_attempts;
  if (retry) {
    const delay = opts.delaySeconds ?? backoffSeconds(job.attempts);
    await query(
      `update public.jobs set status = 'queued', locked_until = null, locked_by = null,
              run_after = now() + make_interval(secs => $3), last_error = $2
       where id = $1`,
      [job.id, error.slice(0, 4000), delay],
    );
    return 'retry';
  }
  await query(
    `update public.jobs set status = 'failed', locked_until = null, last_error = $2, finished_at = now()
     where id = $1`,
    [job.id, error.slice(0, 4000)],
  );
  return 'failed';
}

/** Job yielded (time budget): back to the queue right away, attempt refunded. */
export async function requeueJob(jobId: string): Promise<void> {
  await query(
    `update public.jobs set status = 'queued', locked_until = null, locked_by = null, run_after = now(),
            attempts = greatest(0, attempts - 1)
     where id = $1`,
    [jobId],
  );
}

/** Earliest time a queued job becomes runnable (null if none). */
export async function nextRunAt(): Promise<Date | null> {
  const row = await maybeOne<{ t: Date | null }>(
    `select min(run_after) as t from public.jobs where status = 'queued'
        or (status = 'running' and locked_until < now())`);
  return row?.t ?? null;
}

/** Budget cap hit: park the job. The attempt is refunded; resuming re-queues it. */
export async function pauseJob(jobId: string, reason: string): Promise<void> {
  await query(
    `update public.jobs set status = 'paused', locked_until = null, locked_by = null,
            attempts = greatest(0, attempts - 1), last_error = $2
     where id = $1`,
    [jobId, reason],
  );
}

/** Re-queue paused jobs (e.g. after the budget resets or is raised). */
export async function resumePausedJobs(userId: string): Promise<number> {
  const rows = await query(
    `update public.jobs set status = 'queued', run_after = now(), last_error = null
     where user_id = $1 and status = 'paused'
     returning id`,
    [userId],
  );
  return rows.length;
}
