import { maybeOne, one, query } from '../db/pool';
import { hashOf } from '../hash';
import { ExportOptions, ExportScope, parseBookSettings, type BlockType } from '../types';
import type { RenderBlock, RenderBook } from '../render/document';
import { renderPdf } from '../render/pdf';
import { renderEpub } from '../render/epub';
import { PermanentError, type JobContext } from './context';

/** Bump when renderer output changes, so cached exports are re-rendered. */
export const RENDERER_VERSION = 'r1';

interface ExportRow {
  id: string;
  user_id: string;
  book_id: string;
  format: 'pdf' | 'epub' | 'docx' | 'html' | 'md';
  scope: unknown;
  options: unknown;
}

interface BlockRow {
  id: string;
  batch_id: string;
  type: BlockType;
  level: number | null;
  source_text: string;
  translated_text: string | null;
  user_override: string | null;
  footnote_marker: string | null;
  page_ids: string[];
  translator_notes: string[];
}

export async function loadRenderBook(bookId: string, scope: ExportScope): Promise<RenderBook & { settings: ReturnType<typeof parseBookSettings> }> {
  const book = await one<{ title: string; author: string | null; translator_name: string | null; target_lang: string; source_lang: string; settings: unknown }>(
    'select title, author, translator_name, target_lang, source_lang, settings from public.books where id = $1', [bookId]);
  let rows = await query<BlockRow & { printed: number | null }>(
    `select b.id, b.batch_id, b.type, b.level, b.source_text, b.translated_text, b.user_override, b.footnote_marker,
            b.page_ids, b.translator_notes,
            (select min(p.printed_page_number) from public.pages p where p.id = any(b.page_ids)) as printed
     from public.blocks b where b.book_id = $1 order by b.ordinal`, [bookId]);

  if (scope.type === 'batch') rows = rows.filter((r) => r.batch_id === scope.batchId);
  if (scope.type === 'pages') rows = rows.filter((r) => r.printed !== null && r.printed >= scope.from && r.printed <= scope.to);
  if (scope.type === 'chapter') {
    let ch = -1;
    rows = rows.filter((r) => {
      if (r.type === 'heading' && (r.level ?? 9) <= 1) ch++;
      return Math.max(0, ch) === scope.chapterIndex;
    });
  }

  const blocks: RenderBlock[] = rows.map((r) => {
    const text = r.user_override ?? r.translated_text;
    return {
      id: r.id, type: r.type, level: r.level, footnote_marker: r.footnote_marker, page_ids: r.page_ids,
      source_text: r.source_text, translator_notes: r.translator_notes ?? [],
      text: text ?? r.source_text, untranslated: text == null,
    };
  });
  return {
    title: book.title, author: book.author, translator: book.translator_name, lang: book.target_lang,
    sourceLang: book.source_lang, date: new Date(), blocks, settings: parseBookSettings(book.settings),
  };
}

export async function renderExport(ctx: JobContext, exportId: string) {
  const ex = await maybeOne<ExportRow>('select * from public.exports where id = $1', [exportId]);
  if (!ex) throw new PermanentError(`export ${exportId} not found`);
  if (ex.user_id !== ctx.job.user_id) throw new PermanentError('export does not belong to job owner');
  if (ex.format !== 'pdf' && ex.format !== 'epub') throw new PermanentError(`${ex.format} export is Phase 2`);

  const scope = ExportScope.parse(ex.scope);
  const opts = ExportOptions.parse(ex.options ?? {});
  await query(`update public.exports set status = 'rendering', error = null where id = $1`, [ex.id]);
  const book = await loadRenderBook(ex.book_id, scope);
  if (book.blocks.length === 0) throw new PermanentError('Nothing to export in this scope yet');

  const pdfOpts = {
    pageSize: opts.pageSize ?? book.settings.pageSize,
    bodyFont: opts.bodyFont ?? book.settings.bodyFont,
    fontSizePt: opts.fontSizePt ?? book.settings.fontSizePt,
    grayscale: opts.grayscale ?? false,
  };
  // Content hash (date excluded: re-rendering only because the month changed isn't useful).
  const contentHash = hashOf({ v: RENDERER_VERSION, f: ex.format, o: pdfOpts, t: [book.title, book.author, book.translator, book.lang],
    b: book.blocks.map((b) => [b.id, b.type, b.level, b.text, b.footnote_marker, b.translator_notes]) });

  const cached = await maybeOne<{ storage_path: string; size_bytes: number; page_count: number | null }>(
    `select storage_path, size_bytes, page_count from public.exports
     where book_id = $1 and content_hash = $2 and status = 'done' and storage_path is not null and id <> $3
     order by completed_at desc limit 1`, [ex.book_id, contentHash, ex.id]);
  if (cached) {
    await query(
      `update public.exports set status = 'done', content_hash = $2, storage_path = $3, size_bytes = $4, page_count = $5,
         completed_at = now() where id = $1`,
      [ex.id, contentHash, cached.storage_path, cached.size_bytes, cached.page_count]);
    return { cached: true };
  }

  await ctx.heartbeat();
  let data: Buffer;
  let pageCount: number | null = null;
  if (ex.format === 'pdf') {
    const r = await renderPdf(book, pdfOpts);
    data = r.pdf;
    pageCount = r.pageCount;
  } else {
    data = await renderEpub(book, { bodyFont: pdfOpts.bodyFont, fontSizePt: pdfOpts.fontSizePt, identifier: `urn:uuid:${ex.book_id}` });
  }
  const path = `${ex.user_id}/${ex.book_id}/${contentHash.slice(0, 16)}.${ex.format}`;
  await ctx.deps.storage.upload('exports', path, data, ex.format === 'pdf' ? 'application/pdf' : 'application/epub+zip');
  await query(
    `update public.exports set status = 'done', content_hash = $2, storage_path = $3, size_bytes = $4, page_count = $5,
       completed_at = now() where id = $1`,
    [ex.id, contentHash, path, data.length, pageCount]);
  return { bytes: data.length, pageCount };
}

/** Delete original uploads of a finished batch (user option). Normalized page images are kept. */
export async function cleanupSources(ctx: JobContext, batchId: string) {
  const files = await query<{ id: string; storage_path: string; user_id: string }>(
    `select id, storage_path, user_id from public.source_files where batch_id = $1 and status <> 'deleted'`, [batchId]);
  if (files.some((f) => f.user_id !== ctx.job.user_id)) throw new PermanentError('batch does not belong to job owner');
  await ctx.deps.storage.remove('sources', files.map((f) => f.storage_path));
  await query(`update public.source_files set status = 'deleted' where batch_id = $1`, [batchId]);
  await query(`update public.batches set sources_deleted_at = now() where id = $1`, [batchId]);
  return { deleted: files.length };
}
