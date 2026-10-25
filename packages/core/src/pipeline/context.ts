import type { CallHooks, ModelTransport } from '../openai/structured.js';
import type { Storage } from '../storage.js';
import type { Job } from '../queue.js';

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
