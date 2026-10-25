import { query } from '../db/pool.js';
import { JobPayloads, type JobType } from '../types.js';
import { assembleBatch } from './assemble.js';
import { PermanentError, type JobContext } from './context.js';
import { cleanupSources, renderExport } from './export.js';
import { extractPage } from './extract.js';
import { glossaryBatch } from './glossary.js';
import { ingestBatch } from './ingest.js';
import { translateBatch } from './translate.js';

export * from './context.js';

type Handler = (ctx: JobContext, payload: any) => Promise<unknown>;

const handlers: Partial<Record<JobType, Handler>> = {
  ingest_batch: (c, p) => ingestBatch(c, p.batchId),
  extract_page: (c, p) => extractPage(c, p.pageId),
  assemble_batch: (c, p) => assembleBatch(c, p.batchId),
  glossary_batch: (c, p) => glossaryBatch(c, p.batchId),
  translate_batch: (c, p) => translateBatch(c, p.batchId),
  render_export: (c, p) => renderExport(c, p.exportId),
  cleanup_sources: (c, p) => cleanupSources(c, p.batchId),
};

export async function runJob(ctx: JobContext): Promise<unknown> {
  const h = handlers[ctx.job.type];
  if (!h) throw new PermanentError(`job type ${ctx.job.type} is not implemented yet`);
  const parsed = JobPayloads[ctx.job.type].safeParse(ctx.job.payload);
  if (!parsed.success) throw new PermanentError(`invalid payload: ${parsed.error.message}`);
  return h(ctx, parsed.data);
}

/** Reflect a terminal job failure on the entity the user is looking at. */
export async function markJobFailure(type: JobType, payload: any, message: string, kind: 'error' | 'paused') {
  const msg = message.slice(0, 1000);
  switch (type) {
    case 'ingest_batch': case 'assemble_batch': case 'glossary_batch': case 'translate_batch':
      await query(`update public.batches set status = $2, error = $3 where id = $1`, [payload.batchId, kind, msg]);
      break;
    case 'extract_page':
      if (kind === 'error') {
        await query(`update public.pages set status = 'error', error = $2 where id = $1`, [payload.pageId, msg]);
        // Let the rest of the batch continue without this page.
        const { maybeAssemble } = await import('./extract.js');
        const [p] = await query('select batch_id, user_id, book_id from public.pages where id = $1', [payload.pageId]);
        if (p) await maybeAssemble(p);
      } else {
        await query(`update public.batches b set status = 'paused', error = $2 from public.pages p
                     where p.id = $1 and b.id = p.batch_id`, [payload.pageId, msg]);
      }
      break;
    case 'render_export':
      await query(`update public.exports set status = 'error', error = $2 where id = $1`, [payload.exportId, msg]);
      break;
  }
}
