import { env } from '../config';
import { maybeOne, one, query } from '../db/pool';
import { sha256 } from '../hash';
import { enqueue } from '../queue';
import { normalizeImage } from './image';
import { hasUsableTextLayer, pdfPageTexts, renderPdfPage } from './pdf';
import { checkpoint, JobYield, pagePath, PermanentError, type JobContext } from './context';

interface SourceFile {
  id: string;
  user_id: string;
  book_id: string;
  batch_id: string;
  storage_path: string;
  original_name: string;
  kind: 'image' | 'pdf' | 'epub' | 'docx' | 'text';
  upload_index: number;
  last_modified: Date | null;
  status: string;
}

interface Batch {
  id: string;
  user_id: string;
  book_id: string;
  seq: number;
  status: string;
}

export async function loadBatch(batchId: string, userId: string): Promise<Batch> {
  const b = await maybeOne<Batch>('select * from public.batches where id = $1', [batchId]);
  if (!b) throw new PermanentError(`batch ${batchId} not found`);
  if (b.user_id !== userId) throw new PermanentError('batch does not belong to job owner');
  return b;
}

/** Insert (or find) the page row for one physical page of a source file. Idempotent. */
async function upsertPage(f: SourceFile, sourceIndex: number, name: string): Promise<{ id: string; normalized_path: string | null; status: string }> {
  const existing = await maybeOne<{ id: string; normalized_path: string | null; status: string }>(
    `select id, normalized_path, status from public.pages
     where source_file_id = $1 and source_index = $2 and split_side is null`,
    [f.id, sourceIndex],
  );
  if (existing) return existing;
  return one(
    `insert into public.pages (user_id, book_id, batch_id, source_file_id, source_index, original_name, status)
     values ($1, $2, $3, $4, $5, $6, 'normalizing')
     on conflict (source_file_id, source_index, coalesce(split_side, '')) do update set original_name = excluded.original_name
     returning id, normalized_path, status`,
    [f.user_id, f.book_id, f.batch_id, f.id, sourceIndex, name],
  );
}

async function storeImagePage(ctx: JobContext, f: SourceFile, sourceIndex: number, name: string,
  image: () => Promise<Buffer>, fallbackTakenAt: Date | null): Promise<string> {
  const page = await upsertPage(f, sourceIndex, name);
  if (page.normalized_path) return page.id; // already normalized on a previous attempt / run
  const n = await normalizeImage(await image(), env().OCR_MAX_IMAGE_PX);
  const normPath = pagePath(f.user_id, f.book_id, page.id, 'normalized.jpg');
  const thumbPath = pagePath(f.user_id, f.book_id, page.id, 'thumb.jpg');
  await ctx.deps.storage.upload('pages', normPath, n.normalized, 'image/jpeg');
  await ctx.deps.storage.upload('pages', thumbPath, n.thumb, 'image/jpeg');
  await query(
    `update public.pages set normalized_path = $2, thumb_path = $3, width = $4, height = $5, sha256 = $6,
       exif_taken_at = $7, extraction_method = 'ocr', status = 'queued'
     where id = $1`,
    [page.id, normPath, thumbPath, n.width, n.height, sha256(n.normalized), n.takenAt ?? fallbackTakenAt],
  );
  return page.id;
}

async function storeTextPage(f: SourceFile, sourceIndex: number, name: string, text: string): Promise<string> {
  const page = await upsertPage(f, sourceIndex, name);
  if (page.status !== 'normalizing') return page.id;
  await query(
    `update public.pages set text_layer = $2, sha256 = $3, extraction_method = 'text_layer', status = 'queued'
     where id = $1`,
    [page.id, text, sha256(text)],
  );
  return page.id;
}

/** Split plain text / markdown into pseudo-pages of roughly 3,000 characters at paragraph breaks. */
export function splitTextIntoPages(text: string, target = 3000): string[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const pages: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > target) {
      pages.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) pages.push(cur);
  return pages;
}

/**
 * ingest_batch: turn every uploaded file into normalized page rows, then fan out one
 * extract_page job per page. Safe to re-run: existing pages are reused.
 */
export async function ingestBatch(ctx: JobContext, batchId: string): Promise<{ pages: number }> {
  const batch = await loadBatch(batchId, ctx.job.user_id);
  await query(`update public.batches set status = 'processing', stage = 'ingest', error = null where id = $1`, [batch.id]);
  const files = await query<SourceFile>(
    `select * from public.source_files where batch_id = $1 and status <> 'deleted' order by upload_index, created_at`,
    [batch.id],
  );
  if (files.length === 0) throw new PermanentError('batch has no files');

  for (const f of files) {
    if (f.status === 'ingested' || f.status === 'error') continue; // done in an earlier run
    checkpoint(ctx, 45_000);
    await ctx.heartbeat();
    try {
      const data = await ctx.deps.storage.download('sources', f.storage_path);
      if (f.kind === 'image') {
        await storeImagePage(ctx, f, 0, f.original_name, async () => data, f.last_modified);
      } else if (f.kind === 'pdf') {
        const texts = await pdfPageTexts(data);
        for (let i = 0; i < texts.length; i++) {
          checkpoint(ctx, 30_000); // pages already stored are skipped on the next run
          const name = `${f.original_name} p.${i + 1}`;
          const text = texts[i]!;
          if (hasUsableTextLayer(text)) await storeTextPage(f, i, name, text);
          else await storeImagePage(ctx, f, i, name, () => renderPdfPage(data, i + 1), null);
          if (i % 5 === 4) await ctx.heartbeat();
        }
      } else if (f.kind === 'text') {
        const parts = splitTextIntoPages(data.toString('utf8'));
        for (let i = 0; i < parts.length; i++) await storeTextPage(f, i, `${f.original_name} §${i + 1}`, parts[i]!);
      } else {
        throw new PermanentError(`${f.kind.toUpperCase()} input is not supported yet (Phase 2)`);
      }
      await query(`update public.source_files set status = 'ingested', error = null where id = $1`, [f.id]);
    } catch (err) {
      if (err instanceof JobYield) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log('ingest file failed', { file: f.original_name, error: msg });
      await query(`update public.source_files set status = 'error', error = $2 where id = $1`, [f.id, msg.slice(0, 1000)]);
      if (!(err instanceof PermanentError) && !/unsupported image format|Input buffer/i.test(msg)) throw err;
    }
  }

  // All pages of the batch, in upload order (includes pages stored by earlier runs).
  const pageIds = (await query<{ id: string }>(
    `select p.id from public.pages p join public.source_files f on f.id = p.source_file_id
     where p.batch_id = $1 and p.parent_page_id is null and p.status = 'queued'
     order by f.upload_index, p.source_index`, [batch.id])).map((r) => r.id);
  if (pageIds.length === 0) throw new PermanentError('no readable pages in this batch');
  await query(`update public.batches set stage = 'extract' where id = $1`, [batch.id]);
  // Cover = first page of the first batch.
  await query(
    `update public.books set cover_page_id = $2 where id = $1 and cover_page_id is null`,
    [batch.book_id, pageIds[0]],
  );
  for (const id of pageIds) {
    await enqueue({
      userId: batch.user_id, bookId: batch.book_id, type: 'extract_page',
      payload: { pageId: id }, dedupeKey: `extract_page:${id}`,
    });
  }
  return { pages: pageIds.length };
}
