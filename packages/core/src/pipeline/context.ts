import type { CallHooks, ModelTransport } from '../openai/structured';
import type { Storage } from '../storage';
import type { Job } from '../queue';

export interface PipelineDeps {
  storage: Storage;
  transport: ModelTransport;
  hooks: CallHooks;
}

export interface JobContext {
  job: Job;
  deps: PipelineDeps;
  /** Extends the job lease; call between long steps. */
  heartbeat(): Promise<void>;
  log(msg: string, extra?: Record<string, unknown>): void;
  /** Milliseconds left in this run (Infinity for the long-running Docker worker). */
  timeLeft(): number;
}

/**
 * Thrown by a stage that ran out of time in this run (serverless functions are capped at a few
 * minutes). Progress made so far is already saved; the runner re-queues the job immediately,
 * without counting an attempt, and the next run continues where this one stopped.
 */
export class JobYield extends Error {
  constructor(message = 'time budget used; continuing in the next run') {
    super(message);
    this.name = 'JobYield';
  }
}

/** Yield if less than `minMs` is left. Call before starting a step that can't be interrupted. */
export function checkpoint(ctx: Pick<JobContext, 'timeLeft'>, minMs: number) {
  if (ctx.timeLeft() < minMs) throw new JobYield();
}

/** A failure that retrying will not fix (bad input, missing row). The job fails immediately. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export const pagePath = (userId: string, bookId: string, pageId: string, file: string) =>
  `${userId}/${bookId}/${pageId}/${file}`;
