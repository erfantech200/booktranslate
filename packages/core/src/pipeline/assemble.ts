import { maybeOne, one, query, tx } from '../db/pool';
import { sha256 } from '../hash';
import { enqueue } from '../queue';
import { isRtl, type BlockType, type PageExtraction, type Warning } from '../types';
import { loadBatch } from './ingest';
import type { JobContext } from './context';

// ─── Ordering ───────────────────────────────────────────────────────────────────────────────

export interface OrderablePage {
  id: string;
  printed_page_number: number | null;
  exif_taken_at: Date | null;
  original_name: string | null;
  upload_index: number;
  source_index: number;
  parent_page_id: string | null;
  split_side: 'left' | 'right' | null;
  manual_order: boolean;
  ordinal: number | null;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Page order: printed page number first; unnumbered pages (chapter openers, plates) stay right
 * after the page that preceded them in the fallback order. Fallback order = EXIF capture time,
 * then filename (natural sort), then upload order / PDF page index. Spread halves follow the
 * source language's reading direction. A manual (drag-to-reorder) order always wins.
 */
export function orderPages<T extends OrderablePage>(pages: T[], sourceLang: string): T[] {
  if (pages.some((p) => p.manual_order)) {
    return [...pages].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }
  const rtl = isRtl(sourceLang);
  const sideRank = (p: T) => (p.split_side === null ? 0 : (p.split_side === 'left') !== rtl ? 1 : 2);
  // Children of a split spread sort with their parent's fallback position.
  const byId = new Map(pages.map((p) => [p.id, p]));
  const anchor = (p: T) => (p.parent_page_id && byId.get(p.parent_page_id)) || p;

  const fallback = [...pages].sort((a, b) => {
    // Halves of the same spread: reading direction decides (the parent row itself isn't in the list).
    if (a.parent_page_id && a.parent_page_id === b.parent_page_id) return sideRank(a) - sideRank(b);
    const A = anchor(a);
    const B = anchor(b);
    const ta = A.exif_taken_at?.getTime() ?? null;
    const tb = B.exif_taken_at?.getTime() ?? null;
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (A.id !== B.id) {
      const name = collator.compare(A.original_name ?? '', B.original_name ?? '');
      if (name !== 0 && (ta === null || tb === null || ta === tb)) return name;
      if (A.upload_index !== B.upload_index) return A.upload_index - B.upload_index;
      if (A.source_index !== B.source_index) return A.source_index - B.source_index;
    }
    return sideRank(a) - sideRank(b);
  });

  // Assign each page a sortable key derived from printed numbers.
  const nums = fallback.map((p) => p.printed_page_number);
  const keyed = fallback.map((p, i) => {
    if (p.printed_page_number !== null) return { p, key: p.printed_page_number, sub: 0, i };
    let prev: number | null = null;
    for (let j = i - 1; j >= 0; j--) if (nums[j] != null) { prev = nums[j]!; break; }
    if (prev !== null) return { p, key: prev, sub: 1, i };
    let next: number | null = null;
    for (let j = i + 1; j < nums.length; j++) if (nums[j] != null) { next = nums[j]!; break; }
    return { p, key: next !== null ? next - 0.5 : 0, sub: 1, i };
  });
  keyed.sort((a, b) => a.key - b.key || a.sub - b.sub || a.i - b.i);
  return keyed.map((k) => k.p);
}

// ─── Stitching ──────────────────────────────────────────────────────────────────────────────

export interface StitchPage {
  id: string;
  extraction: PageExtraction;
}

export interface StitchedBlock {
  type: BlockType;
  level: number | null;
  footnote_marker: string | null;
  text: string;
  page_ids: string[];
  local_ids: string[];
  starts_mid_sentence: boolean;
  ends_mid_sentence: boolean;
}

export interface PreviousTail {
  id: string;
  type: BlockType;
  text: string;
  ends_mid_sentence: boolean;
  local_ids: string[];
}

const MERGEABLE: BlockType[] = ['paragraph', 'quote', 'list_item', 'poem'];
const TERMINAL_PUNCT = /[.!?…:;"”’»)\]]\s*(\[\^[^\]]+\])?$/;

function shouldMerge(prev: { type: BlockType; text: string; ends_mid_sentence: boolean },
  next: { type: BlockType; text: string; starts_mid_sentence: boolean }): boolean {
  if (!MERGEABLE.includes(prev.type) || prev.type !== next.type) return false;
  if (prev.ends_mid_sentence || next.starts_mid_sentence) return true;
  // Fallback when the model didn't flag it: no terminal punctuation + lowercase continuation.
  return !TERMINAL_PUNCT.test(prev.text.trim()) && /^[a-z(“"‘']/.test(next.text.trim());
}

export function joinText(a: string, b: string, type: BlockType): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (type === 'poem') return `${left}\n${right}`;
  // Hyphenated word split across the page break: "transla-" + "tion".
  if (/\p{L}-$/u.test(left) && /^\p{Ll}/u.test(right)) return left.slice(0, -1) + right;
  return `${left} ${right}`;
}

/**
 * Merge paragraphs split across page boundaries. Footnotes never take part in merges (they
 * sit at the page bottom, between the two halves of a split paragraph).
 */
export function stitch(pages: StitchPage[], prevTail: PreviousTail | null): {
  blocks: StitchedBlock[];
  mergeIntoPrevious: { text: string; page_id: string; local_id: string; ends_mid_sentence: boolean } | null;
} {
  const blocks: StitchedBlock[] = [];
  let lastBody: StitchedBlock | null = null;
  let mergeIntoPrevious: ReturnType<typeof stitch>['mergeIntoPrevious'] = null;

  for (const page of pages) {
    let first = true;
    for (const b of page.extraction.blocks) {
      const localId = `${page.id}#${b.id}`;
      if (b.type === 'footnote') {
        blocks.push({
          type: 'footnote', level: null, footnote_marker: b.footnote_marker, text: b.text,
          page_ids: [page.id], local_ids: [localId], starts_mid_sentence: false, ends_mid_sentence: false,
        });
        continue;
      }
      const isFirstBody = first;
      first = false;
      if (isFirstBody && lastBody && shouldMerge(lastBody, b)) {
        lastBody.text = joinText(lastBody.text, b.text, b.type);
        if (!lastBody.page_ids.includes(page.id)) lastBody.page_ids.push(page.id);
        lastBody.local_ids.push(localId);
        lastBody.ends_mid_sentence = b.ends_mid_sentence;
        continue;
      }
      if (isFirstBody && !lastBody && blocks.length === 0 && prevTail && shouldMerge(prevTail, b)) {
        mergeIntoPrevious = { text: b.text, page_id: page.id, local_id: localId, ends_mid_sentence: b.ends_mid_sentence };
        // Later blocks may still merge into the (remote) previous tail via this marker.
        lastBody = null;
        continue;
      }
      const nb: StitchedBlock = {
        type: b.type, level: b.level, footnote_marker: null, text: b.text, page_ids: [page.id],
        local_ids: [localId], starts_mid_sentence: b.starts_mid_sentence, ends_mid_sentence: b.ends_mid_sentence,
      };
      blocks.push(nb);
      lastBody = nb;
    }
  }
  return { blocks, mergeIntoPrevious };
}

// ─── Quality gate (warnings) ────────────────────────────────────────────────────────────────

export interface QualityPage {
  id: string;
  printed_page_number: number | null;
  sha256: string | null;
  quality: { legibility: number; cut_off: boolean; blur: boolean; glare: boolean } | null;
  blockCount: number;
  status: string;
}

export function qualityWarnings(ordered: QualityPage[], previousMaxPage: number | null): Warning[] {
  const w: Warning[] = [];
  const numbered = ordered.filter((p) => p.printed_page_number !== null);
  for (let i = 1; i < numbered.length; i++) {
    const a = numbered[i - 1]!.printed_page_number!;
    const b = numbered[i]!.printed_page_number!;
    if (b - a > 1) {
      w.push({ code: 'missing_pages', message: b - a === 2 ? `Page ${a + 1} is missing` : `Pages ${a + 1}–${b - 1} are missing`,
        pageId: numbered[i]!.id, data: { from: a + 1, to: b - 1 } });
    }
  }
  const seenNum = new Map<number, string>();
  const seenHash = new Map<string, string>();
  for (const p of ordered) {
    if (p.printed_page_number !== null) {
      const dup = seenNum.get(p.printed_page_number);
      if (dup) w.push({ code: 'duplicate_page', pageId: p.id, message: `Page ${p.printed_page_number} appears twice`, data: { other: dup } });
      else seenNum.set(p.printed_page_number, p.id);
    }
    if (p.sha256) {
      const dup = seenHash.get(p.sha256);
      if (dup && p.printed_page_number === null) w.push({ code: 'duplicate_page', pageId: p.id, message: 'This photo was uploaded twice', data: { other: dup } });
      else seenHash.set(p.sha256, p.id);
    }
    const q = p.quality;
    if (q) {
      if (q.legibility < 0.6) w.push({ code: 'low_quality', pageId: p.id, message: 'Hard to read — retake this page' });
      if (q.blur) w.push({ code: 'blur', pageId: p.id, message: 'Blurry — retake this page' });
      if (q.glare) w.push({ code: 'glare', pageId: p.id, message: 'Glare on the page — retake at an angle' });
      if (q.cut_off) w.push({ code: 'cut_off', pageId: p.id, message: 'Text is cut off at the edge — retake with the whole page in frame' });
    }
    if (p.status === 'extracted' && p.blockCount === 0) w.push({ code: 'no_text', pageId: p.id, message: 'No text found on this page' });
    if (p.status === 'error') w.push({ code: 'needs_review', pageId: p.id, message: 'Could not read this page — retake it' });
  }
  const minHere = numbered.length ? Math.min(...numbered.map((p) => p.printed_page_number!)) : null;
  if (previousMaxPage !== null && minHere !== null) {
    if (minHere <= previousMaxPage) {
      w.push({ code: 'overlaps_previous_batch', message: `This batch starts at page ${minHere}, but earlier batches already reach page ${previousMaxPage}`, data: { minHere, previousMaxPage } });
    } else if (minHere > previousMaxPage + 1) {
      w.push({ code: 'missing_pages', message: minHere - previousMaxPage === 2 ? `Page ${previousMaxPage + 1} is missing` : `Pages ${previousMaxPage + 1}–${minHere - 1} are missing (between batches)`, data: { from: previousMaxPage + 1, to: minHere - 1 } });
    }
  }
  return w;
}

// ─── Stage handler ──────────────────────────────────────────────────────────────────────────

export const blockSourceHash = (b: { type: string; level: number | null; text: string; footnote_marker: string | null }) =>
  sha256(`${b.type}|${b.level ?? ''}|${b.footnote_marker ?? ''}|${b.text}`);

/** Block ordinals are book-wide: batch seq × 1e6 + position, so batches never interleave. */
export const BATCH_ORDINAL_SPAN = 1_000_000;

export async function assembleBatch(ctx: JobContext, batchId: string) {
  const batch = await loadBatch(batchId, ctx.job.user_id);
  const book = await one<{ source_lang: string }>('select source_lang from public.books where id = $1', [batch.book_id]);
  await query(`update public.batches set stage = 'assemble' where id = $1`, [batch.id]);

  const rows = await query<OrderablePage & { status: string; sha256: string | null; quality: any; extraction: PageExtraction | null }>(
    `select p.id, p.printed_page_number, p.exif_taken_at, p.original_name, coalesce(f.upload_index, 0) as upload_index,
            p.source_index, p.parent_page_id, p.split_side, p.manual_order, p.ordinal, p.status, p.sha256, p.quality, p.extraction
     from public.pages p left join public.source_files f on f.id = p.source_file_id
     where p.batch_id = $1`,
    [batch.id],
  );
  const usable = rows.filter((p) => p.status !== 'split');
  const ordered = orderPages(usable, book.source_lang);

  const prevTail = await maybeOne<PreviousTail & { ordinal: number }>(
    `select id, type, source_text as text, ends_mid_sentence, local_ids, ordinal from public.blocks
     where book_id = $1 and ordinal < $2 and type <> 'footnote' order by ordinal desc limit 1`,
    [batch.book_id, batch.seq * BATCH_ORDINAL_SPAN],
  );
  const prevMax = await maybeOne<{ n: number | null }>(
    `select max(p.printed_page_number) as n from public.pages p join public.batches b on b.id = p.batch_id
     where p.book_id = $1 and b.seq < $2`,
    [batch.book_id, batch.seq],
  );

  const stitchPages = ordered.filter((p) => p.extraction && p.status !== 'error')
    .map((p) => ({ id: p.id, extraction: p.extraction! }));
  // If the previous tail already absorbed this batch's first block (earlier run), don't merge twice.
  const alreadyMerged = prevTail?.local_ids.some((l) => stitchPages.some((p) => l.startsWith(`${p.id}#`))) ?? false;
  const { blocks, mergeIntoPrevious } = stitch(stitchPages, alreadyMerged ? null : prevTail);
  const skipFirstLocal = alreadyMerged ? prevTail!.local_ids.filter((l) => stitchPages.some((p) => l.startsWith(`${p.id}#`))) : [];
  const finalBlocks = skipFirstLocal.length
    ? blocks.filter((b) => !(b.local_ids.length === 1 && skipFirstLocal.includes(b.local_ids[0]!)))
    : blocks;

  const blockCount = new Map<string, number>();
  for (const b of finalBlocks) for (const id of b.page_ids) blockCount.set(id, (blockCount.get(id) ?? 0) + 1);
  if (mergeIntoPrevious) blockCount.set(mergeIntoPrevious.page_id, (blockCount.get(mergeIntoPrevious.page_id) ?? 0) + 1);
  for (const l of skipFirstLocal) { const pid = l.split('#')[0]!; blockCount.set(pid, (blockCount.get(pid) ?? 0) + 1); }

  const warnings = qualityWarnings(
    ordered.map((p) => ({ id: p.id, printed_page_number: p.printed_page_number, sha256: p.sha256, quality: p.quality,
      blockCount: blockCount.get(p.id) ?? 0, status: p.status })),
    prevMax?.n ?? null,
  );

  await tx(async (c) => {
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i]!;
      const pageWarnings = warnings.filter((w) => w.pageId === p.id);
      const ordinal = p.manual_order ? p.ordinal : batch.seq * 10_000 + i;
      const status = p.status === 'extracted' && (blockCount.get(p.id) ?? 0) === 0 ? 'skipped' : p.status;
      await query(`update public.pages set ordinal = $2, warnings = $3, status = $4 where id = $1`,
        [p.id, ordinal, JSON.stringify(pageWarnings), status], c);
    }

    // Sync blocks, keeping translations/overrides of blocks whose source didn't change.
    const existing = await query<{ id: string; source_hash: string }>(
      'select id, source_hash from public.blocks where batch_id = $1 order by ordinal', [batch.id], c);
    const pool = new Map<string, string[]>();
    for (const e of existing) pool.set(e.source_hash, [...(pool.get(e.source_hash) ?? []), e.id]);
    const keep = new Set<string>();
    for (let i = 0; i < finalBlocks.length; i++) {
      const b = finalBlocks[i]!;
      const h = blockSourceHash(b);
      const ordinal = batch.seq * BATCH_ORDINAL_SPAN + i + 1;
      const reuse = pool.get(h)?.shift();
      if (reuse) {
        keep.add(reuse);
        await query(
          `update public.blocks set ordinal = $2, page_ids = $3, local_ids = $4, starts_mid_sentence = $5, ends_mid_sentence = $6
           where id = $1`,
          [reuse, ordinal, b.page_ids, b.local_ids, b.starts_mid_sentence, b.ends_mid_sentence], c);
      } else {
        const row = await one<{ id: string }>(
          `insert into public.blocks (user_id, book_id, batch_id, ordinal, page_ids, local_ids, type, level, footnote_marker,
             source_text, source_hash, starts_mid_sentence, ends_mid_sentence)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
          [batch.user_id, batch.book_id, batch.id, ordinal, b.page_ids, b.local_ids, b.type, b.level, b.footnote_marker,
           b.text, h, b.starts_mid_sentence, b.ends_mid_sentence], c);
        keep.add(row.id);
      }
    }
    const stale = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (stale.length) await query('delete from public.blocks where id = any($1::uuid[])', [stale], c);

    // Paragraph continuing from the previous batch: append to that block (it gets retranslated).
    if (mergeIntoPrevious && prevTail) {
      const text = joinText(prevTail.text, mergeIntoPrevious.text, prevTail.type);
      await query(
        `update public.blocks set source_text = $2, source_hash = $3,
           page_ids = array_append(page_ids, $4::uuid), local_ids = array_append(local_ids, $5),
           ends_mid_sentence = $6
         where id = $1`,
        [prevTail.id, text, blockSourceHash({ type: prevTail.type, level: null, footnote_marker: null, text }), mergeIntoPrevious.page_id,
         mergeIntoPrevious.local_id, mergeIntoPrevious.ends_mid_sentence], c);
    }

    await query(`update public.batches set warnings = $2, stage = 'glossary' where id = $1`,
      [batch.id, JSON.stringify(warnings.filter((w) => !w.pageId || ['missing_pages', 'duplicate_page'].includes(w.code)))], c);
  });

  await enqueue({ userId: batch.user_id, bookId: batch.book_id, type: 'glossary_batch',
    payload: { batchId: batch.id }, dedupeKey: `glossary_batch:${batch.id}` });
  return { pages: ordered.length, blocks: finalBlocks.length, warnings: warnings.length };
}
