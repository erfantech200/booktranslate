import { env, stageModel } from '../config';
import { maybeOne, one, query } from '../db/pool';
import { hashOf, sha256 } from '../hash';
import { InvalidModelOutputError, structuredCall } from '../openai/structured';
import { ocrPrompt, PROMPT_VERSIONS, structurePrompt } from '../prompts';
import { enqueue } from '../queue';
import { PageExtraction, type ExtractedBlock } from '../types';
import { splitSpread, thumbnail, toDataUrl } from './image';
import { pagePath, PermanentError, type JobContext } from './context';

interface PageRow {
  id: string;
  user_id: string;
  book_id: string;
  batch_id: string;
  source_file_id: string | null;
  source_index: number;
  parent_page_id: string | null;
  split_side: 'left' | 'right' | null;
  original_name: string | null;
  normalized_path: string | null;
  sha256: string | null;
  extraction_method: 'ocr' | 'text_layer' | null;
  text_layer: string | null;
  exif_taken_at: Date | null;
  extract_hash: string | null;
  status: string;
}

const TERMINAL = ['extracted', 'split', 'error', 'skipped', 'translating', 'translated', 'needs_review'];

/** Normalize model output: clamp ranges, drop empty blocks, keep only valid heading levels. */
export function cleanExtraction(x: PageExtraction): PageExtraction {
  const blocks: ExtractedBlock[] = x.blocks
    .map((b) => ({
      ...b,
      text: b.text.replace(/[ \t]+\n/g, '\n').trim(),
      level: b.type === 'heading' ? Math.min(6, Math.max(1, b.level ?? 2)) : null,
      footnote_marker: b.type === 'footnote' ? (b.footnote_marker?.trim() || null) : null,
    }))
    .filter((b) => b.text.length > 0);
  return {
    ...x,
    blocks,
    quality: { ...x.quality, legibility: Math.min(1, Math.max(0, x.quality.legibility)) },
  };
}

function checkExtraction(x: PageExtraction): string | null {
  const ids = new Set<string>();
  for (const b of x.blocks) {
    if (ids.has(b.id)) return `duplicate block id ${b.id}`;
    ids.add(b.id);
  }
  return null;
}

export async function extractPage(ctx: JobContext, pageId: string): Promise<{ status: string }> {
  const page = await maybeOne<PageRow>('select * from public.pages where id = $1', [pageId]);
  if (!page) throw new PermanentError(`page ${pageId} not found`);
  if (page.user_id !== ctx.job.user_id) throw new PermanentError('page does not belong to job owner');
  if (page.status === 'split') return { status: 'split' };
  const book = await one<{ source_lang: string }>('select source_lang from public.books where id = $1', [page.book_id]);

  const stage = page.extraction_method === 'text_layer' ? 'structure' : 'ocr';
  const sm = stageModel(stage);
  const hash = hashOf({ input: page.sha256, model: sm.model, effort: sm.effort,
    prompt: stage === 'ocr' ? PROMPT_VERSIONS.ocr : PROMPT_VERSIONS.structure, lang: book.source_lang });
  if (page.extract_hash === hash && TERMINAL.includes(page.status)) {
    await maybeAssemble(page);
    return { status: 'unchanged' };
  }

  await query(`update public.pages set status = 'extracting', error = null where id = $1`, [page.id]);
  const callCtx = { userId: page.user_id, bookId: page.book_id, batchId: page.batch_id, pageId: page.id, jobId: ctx.job.id };

  let extraction: PageExtraction;
  try {
    if (stage === 'ocr') {
      if (!page.normalized_path) throw new PermanentError('page has no normalized image');
      const img = await ctx.deps.storage.download('pages', page.normalized_path);
      const r = await structuredCall({
        transport: ctx.deps.transport, hooks: ctx.deps.hooks, ctx: callCtx, stage: 'ocr',
        model: sm.model, effort: sm.effort, schema: PageExtraction, schemaName: 'page_extraction',
        instructions: ocrPrompt(book.source_lang),
        input: [{ role: 'user', content: [
          { type: 'input_text', text: page.split_side
            ? `This is the ${page.split_side} half of a two-page spread; it shows a single page. is_spread must be false.`
            : 'Extract this page.' },
          { type: 'input_image', image_url: toDataUrl(img), detail: env().OCR_IMAGE_DETAIL },
        ] }],
        cacheKey: `ocr:${PROMPT_VERSIONS.ocr}`,
        check: checkExtraction,
      });
      extraction = cleanExtraction(r.value);
    } else {
      const r = await structuredCall({
        transport: ctx.deps.transport, hooks: ctx.deps.hooks, ctx: callCtx, stage: 'structure',
        model: sm.model, effort: sm.effort, schema: PageExtraction, schemaName: 'page_extraction',
        instructions: structurePrompt(book.source_lang),
        input: [{ role: 'user', content: `Raw text layer:\n\n${page.text_layer ?? ''}` }],
        cacheKey: `structure:${PROMPT_VERSIONS.structure}`,
        check: checkExtraction,
      });
      extraction = cleanExtraction({ ...r.value, is_spread: false });
    }
  } catch (err) {
    if (err instanceof InvalidModelOutputError) {
      // Retried once already inside structuredCall → flag the page instead of looping.
      await query(
        `update public.pages set status = 'error', error = $2,
           warnings = $3 where id = $1`,
        [page.id, `Extraction failed: ${err.issues}`.slice(0, 1000),
         JSON.stringify([{ code: 'needs_review', pageId: page.id, message: 'Could not read this page. Retake the photo.' }])],
      );
      await maybeAssemble(page);
      return { status: 'error' };
    }
    throw err;
  }

  // Two pages in one photo: split once, OCR each half separately.
  if (stage === 'ocr' && extraction.is_spread && !page.split_side && page.normalized_path) {
    await splitPage(ctx, page, hash, extraction);
    return { status: 'split' };
  }

  await query(
    `update public.pages set extraction = $2, extract_hash = $3, printed_page_number = $4, is_spread = $5,
       quality = $6, status = 'extracted', error = null
     where id = $1`,
    [page.id, JSON.stringify(extraction), hash, extraction.printed_page_number, extraction.is_spread,
     JSON.stringify(extraction.quality)],
  );
  await maybeAssemble(page);
  return { status: 'extracted' };
}

async function splitPage(ctx: JobContext, page: PageRow, hash: string, extraction: PageExtraction) {
  const img = await ctx.deps.storage.download('pages', page.normalized_path!);
  const [left, right] = await splitSpread(img);
  for (const [side, buf] of [['left', left], ['right', right]] as const) {
    const child = await one<{ id: string }>(
      `insert into public.pages (user_id, book_id, batch_id, source_file_id, parent_page_id, split_side, source_index,
         original_name, exif_taken_at, extraction_method, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ocr','normalizing')
       on conflict (source_file_id, source_index, coalesce(split_side, '')) do update set parent_page_id = excluded.parent_page_id
       returning id`,
      [page.user_id, page.book_id, page.batch_id, page.source_file_id, page.id, side, page.source_index,
       `${page.original_name ?? 'page'} (${side})`, page.exif_taken_at],
    );
    const normPath = pagePath(page.user_id, page.book_id, child.id, 'normalized.jpg');
    const thumbPath = pagePath(page.user_id, page.book_id, child.id, 'thumb.jpg');
    await ctx.deps.storage.upload('pages', normPath, buf, 'image/jpeg');
    await ctx.deps.storage.upload('pages', thumbPath, await thumbnail(buf), 'image/jpeg');
    await query(
      `update public.pages set normalized_path = $2, thumb_path = $3, sha256 = $4, status = 'queued' where id = $1`,
      [child.id, normPath, thumbPath, sha256(buf)],
    );
    await enqueue({ userId: page.user_id, bookId: page.book_id, type: 'extract_page',
      payload: { pageId: child.id }, dedupeKey: `extract_page:${child.id}` });
  }
  await query(
    `update public.pages set status = 'split', is_spread = true, extract_hash = $2, quality = $3, extraction = null
     where id = $1`,
    [page.id, hash, JSON.stringify(extraction.quality)],
  );
}

/** When every page of the batch has finished extracting, enqueue assembly (once). */
export async function maybeAssemble(page: Pick<PageRow, 'batch_id' | 'user_id' | 'book_id'>) {
  const pending = await one<{ n: number }>(
    `select count(*)::int as n from public.pages
     where batch_id = $1 and status not in ('extracted', 'split', 'error', 'skipped', 'translating', 'translated', 'needs_review')`,
    [page.batch_id],
  );
  if (pending.n > 0) return;
  await enqueue({ userId: page.user_id, bookId: page.book_id, type: 'assemble_batch',
    payload: { batchId: page.batch_id }, dedupeKey: `assemble_batch:${page.batch_id}` });
}
