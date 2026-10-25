import pLimit from 'p-limit';
import { env, stageModel } from '../config.js';
import { estimateTokens } from '../cost.js';
import { one, query } from '../db/pool.js';
import { hashOf } from '../hash.js';
import { autoFix, lintBlock, type GlossaryEntry } from '../lint/index.js';
import { InvalidModelOutputError, structuredCall } from '../openai/structured.js';
import { PROMPT_VERSIONS, styleGuide, translateSystemPrompt } from '../prompts.js';
import { enqueue } from '../queue.js';
import { parseBookSettings, TranslationOutput, type BookBrief, type BookSettings, type LintFlag } from '../types.js';
import { loadBatch } from './ingest.js';
import type { JobContext } from './context.js';

export interface TBlock {
  id: string;
  ordinal: number;
  type: string;
  level: number | null;
  source_text: string;
  source_hash: string;
  starts_mid_sentence: boolean;
  page_ids: string[];
  batch_id: string;
  translated_text: string | null;
  translation_hash: string | null;
  status: string;
}

export interface GlossaryTerm extends GlossaryEntry {
  kind: string;
  notes: string | null;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────────────────────

/**
 * Group blocks into chunks of whole blocks: flush before exceeding `max` tokens, and prefer
 * flushing at a heading once the chunk holds at least `min`. A block longer than `max` is a
 * chunk of its own. Paragraphs are never split.
 */
export function chunkBlocks<T extends { source_text: string; type: string }>(blocks: T[], min: number, max: number): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let tokens = 0;
  for (const b of blocks) {
    const t = estimateTokens(b.source_text) + 12;
    const headingBreak = b.type === 'heading' && tokens >= min;
    if (cur.length && (tokens + t > max || headingBreak)) {
      chunks.push(cur);
      cur = [];
      tokens = 0;
    }
    cur.push(b);
    tokens += t;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const termRe = (term: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');

export function termsIn(text: string, glossary: GlossaryTerm[]): GlossaryTerm[] {
  return glossary.filter((g) => termRe(g.source_term).test(text));
}

/** For "show the Latin original at first occurrence": block id → names first seen in it. */
export function firstOccurrences(blocks: Pick<TBlock, 'id' | 'source_text'>[], glossary: GlossaryTerm[]): Map<string, string[]> {
  const names = glossary.filter((g) => g.kind === 'character' || g.kind === 'place' || g.kind === 'organization');
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const b of blocks) {
    for (const n of names) {
      const key = n.source_term.toLowerCase();
      if (seen.has(key) || !termRe(n.source_term).test(b.source_text)) continue;
      seen.add(key);
      out.set(b.id, [...(out.get(b.id) ?? []), n.source_term]);
    }
  }
  return out;
}

export function translationHash(b: Pick<TBlock, 'source_hash' | 'source_text'>, opts: {
  model: string; effort: string; settings: BookSettings; glossary: GlossaryTerm[]; firstOcc: string[];
}): string {
  return hashOf({
    src: b.source_hash,
    model: opts.model,
    effort: opts.effort,
    prompt: PROMPT_VERSIONS.translate,
    style: PROMPT_VERSIONS.style,
    s: [opts.settings.dialogueRegister, opts.settings.persianDigits, opts.settings.showLatinNames, opts.settings.translatorNotes],
    terms: termsIn(b.source_text, opts.glossary).map((g) => [g.source_term, g.target_term, g.locked]).sort(),
    first: opts.settings.showLatinNames ? opts.firstOcc : [],
  });
}

export function formatGlossary(glossary: GlossaryTerm[]): string {
  if (glossary.length === 0) return '(empty)';
  return [...glossary]
    .sort((a, b) => a.source_term.localeCompare(b.source_term))
    .map((g) => `- ${g.source_term} → ${g.target_term}${g.locked ? ' [LOCKED]' : ''} (${g.kind})${g.notes ? ` — ${g.notes}` : ''}`)
    .join('\n');
}

/** Stable prefix for prompt caching: system → style guide → brief → glossary. */
export function buildInstructions(o: {
  sourceLang: string; targetLang: string; settings: BookSettings; brief: BookBrief | null; glossary: GlossaryTerm[];
}): string {
  const brief = o.brief
    ? `Genre: ${o.brief.genre}\nEra/setting: ${o.brief.era}\nNarrator POV: ${o.brief.narrator_pov}\nTone: ${o.brief.tone}\nAudience: ${o.brief.audience}\nContext: ${o.brief.summary_for_translator}`
    : '(not available yet)';
  return [
    translateSystemPrompt(o.sourceLang, o.targetLang),
    '## Style guide',
    styleGuide(o.targetLang, o.settings),
    '## Book brief',
    brief,
    '## Glossary (source → rendering)',
    formatGlossary(o.glossary),
  ].join('\n\n');
}

export function buildChunkMessage(o: {
  context: { source: string; translation: string | null }[];
  items: { key: string; type: string; level: number | null; text: string; continues: boolean; firstOcc: string[] }[];
  showLatinNames: boolean;
  extraNote?: string;
}): string {
  const ctx = o.context.length
    ? o.context.map((c) => (c.translation ? `SOURCE: ${c.source}\nTRANSLATION: ${c.translation}` : `SOURCE: ${c.source}`)).join('\n---\n')
    : '(start of book)';
  const items = o.items.map((i) => ({
    id: i.key,
    type: i.level ? `${i.type} (level ${i.level})` : i.type,
    ...(i.continues ? { continues_from_previous: true } : {}),
    ...(o.showLatinNames && i.firstOcc.length ? { first_occurrence: i.firstOcc } : {}),
    text: i.text,
  }));
  return [
    'Previous context (for continuity only; do not translate or output):',
    ctx,
    '',
    `Blocks to translate (${items.length}). Return exactly one translation per id:`,
    JSON.stringify(items, null, 1),
    ...(o.extraNote ? ['', o.extraNote] : []),
  ].join('\n');
}

const RETRYABLE_FLAGS: LintFlag['code'][] = ['untranslated_latin', 'length_ratio', 'glossary_violation', 'empty_translation'];

// ─── Stage handler ──────────────────────────────────────────────────────────────────────────

export async function translateBatch(ctx: JobContext, batchId: string) {
  const batch = await loadBatch(batchId, ctx.job.user_id);
  const book = await one<{ id: string; source_lang: string; target_lang: string; settings: unknown; brief: BookBrief | null }>(
    'select id, source_lang, target_lang, settings, brief from public.books where id = $1', [batch.book_id]);
  const settings = parseBookSettings(book.settings);
  const sm = stageModel('translate', settings.quality);
  const e = env();

  const glossary = await query<GlossaryTerm>(
    'select source_term, target_term, kind, notes, locked from public.glossary_terms where book_id = $1', [book.id]);
  // The whole book: blocks from earlier batches may be stale too (cross-batch stitch, edited glossary).
  const all = await query<TBlock>(
    `select id, ordinal, type, level, source_text, source_hash, starts_mid_sentence, page_ids, batch_id,
            translated_text, translation_hash, status
     from public.blocks where book_id = $1 order by ordinal`, [book.id]);
  const firstOcc = firstOccurrences(all, glossary);
  const expected = new Map(all.map((b) => [b.id, translationHash(b, {
    model: sm.model, effort: sm.effort, settings, glossary, firstOcc: firstOcc.get(b.id) ?? [] })]));
  const stale = all.filter((b) => b.translation_hash !== expected.get(b.id));

  const instructions = buildInstructions({ sourceLang: book.source_lang, targetLang: book.target_lang, settings, brief: book.brief, glossary });
  const indexOf = new Map(all.map((b, i) => [b.id, i]));
  const translatedNow = new Map<string, string>();
  const touchedPages = new Set<string>();
  stale.forEach((b) => b.page_ids.forEach((p) => touchedPages.add(p)));
  if (touchedPages.size) {
    await query(`update public.pages set status = 'translating' where id = any($1::uuid[]) and status in ('extracted', 'translated', 'needs_review')`,
      [[...touchedPages]]);
  }

  const chunks = chunkBlocks(stale, e.TRANSLATION_CHUNK_MIN_TOKENS, e.TRANSLATION_CHUNK_MAX_TOKENS);
  const limit = pLimit(e.TRANSLATION_CONCURRENCY);
  const callCtx = { userId: batch.user_id, bookId: book.id, batchId: batch.id, jobId: ctx.job.id };
  let reviewCount = 0;

  const runChunk = async (chunk: TBlock[]) => {
    const start = indexOf.get(chunk[0]!.id)!;
    const context = all.slice(0, start).filter((b) => b.type !== 'footnote').slice(-e.TRANSLATION_CONTEXT_BLOCKS)
      .map((b) => ({ source: b.source_text, translation: translatedNow.get(b.id) ?? (b.translation_hash ? b.translated_text : null) }));
    const keyOf = new Map(chunk.map((b, i) => [`k${i + 1}`, b]));
    const items = [...keyOf].map(([key, b]) => ({ key, type: b.type, level: b.level, text: b.source_text,
      continues: b.starts_mid_sentence, firstOcc: firstOcc.get(b.id) ?? [] }));

    const call = (subset: typeof items, extraNote?: string) => structuredCall({
      transport: ctx.deps.transport, hooks: ctx.deps.hooks, ctx: callCtx, stage: 'translate',
      model: sm.model, effort: sm.effort, schema: TranslationOutput, schemaName: 'translation',
      instructions,
      input: [{ role: 'user', content: buildChunkMessage({ context, items: subset, showLatinNames: settings.showLatinNames, extraNote }) }],
      cacheKey: `translate:${book.id}`,
      check: (v) => {
        const want = new Set(subset.map((i) => i.key));
        const got = v.translations.map((t) => t.id);
        const missing = [...want].filter((k) => !got.includes(k));
        const extra = got.filter((k) => !want.has(k));
        if (missing.length) return `missing translations for ids ${missing.join(', ')}`;
        if (extra.length) return `unknown ids ${extra.join(', ')}`;
        if (new Set(got).size !== got.length) return 'duplicate ids';
        return null;
      },
    });

    let out: TranslationOutput;
    try {
      out = (await call(items)).value;
    } catch (err) {
      if (!(err instanceof InvalidModelOutputError)) throw err;
      reviewCount += chunk.length;
      for (const b of chunk) {
        await query(`update public.blocks set status = 'error', lint_flags = $2 where id = $1`,
          [b.id, JSON.stringify([{ code: 'invalid_output', message: 'Model output invalid after retry', detail: err.issues }])]);
      }
      return;
    }

    const lintOf = (key: string, text: string) => {
      const b = keyOf.get(key)!;
      return lintBlock({ targetLang: book.target_lang, sourceText: b.source_text, translatedText: text,
        glossary: termsIn(b.source_text, glossary), persianDigits: settings.persianDigits, blockType: b.type });
    };
    const results = new Map(out.translations.map((t) => [t.id, lintOf(t.id, t.text)]));
    const notes = new Map<string, string[]>();
    for (const n of out.translator_notes) {
      const k = out.translations.find((t) => t.id === n.block_id)?.id;
      if (k && settings.translatorNotes) notes.set(k, [...(notes.get(k) ?? []), n.note]);
    }

    // Auto-retry once for blocks with fixable problems, then keep the better result and flag.
    const flagged = [...results].filter(([, r]) => r.flags.some((f) => RETRYABLE_FLAGS.includes(f.code)));
    if (flagged.length) {
      const note = 'Fix these problems from your previous attempt:\n' + flagged
        .map(([k, r]) => `- ${k}: ${r.flags.map((f) => f.message + (f.detail ? ` (${f.detail})` : '')).join('; ')}`).join('\n');
      try {
        const retry = (await call(items.filter((i) => flagged.some(([k]) => k === i.key)), note)).value;
        for (const t of retry.translations) {
          const r = lintOf(t.id, t.text);
          if (r.flags.length <= (results.get(t.id)?.flags.length ?? Infinity)) results.set(t.id, r);
        }
      } catch (err) {
        if (!(err instanceof InvalidModelOutputError)) throw err;
      }
    }

    for (const [key, r] of results) {
      const b = keyOf.get(key)!;
      const status = r.flags.length ? 'needs_review' : 'translated';
      if (status === 'needs_review') reviewCount++;
      const blockNotes = (notes.get(key) ?? []).map((n) => autoFix(book.target_lang, n, { persianDigits: settings.persianDigits }).text);
      await query(
        `update public.blocks set translated_text = $2, translation_hash = $3, translation_model = $4, translated_at = now(),
           lint_flags = $5, translator_notes = $6, status = $7
         where id = $1`,
        [b.id, r.text, expected.get(b.id), sm.model, JSON.stringify(r.flags), JSON.stringify(blockNotes), status],
      );
      translatedNow.set(b.id, r.text);
    }
    await refreshPageStatuses([...new Set(chunk.flatMap((b) => b.page_ids))]);
    await ctx.heartbeat();
  };

  await Promise.all(chunks.map((c) => limit(() => runChunk(c))));

  const left = await one<{ pending: number; review: number }>(
    `select count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status in ('needs_review', 'error'))::int as review
     from public.blocks where batch_id = $1`, [batch.id]);
  const status = left.pending > 0 || left.review > 0 ? 'needs_review' : 'done';
  await query(`update public.batches set status = $2, stage = null, completed_at = now() where id = $1`, [batch.id, status]);
  await refreshPageStatuses([...touchedPages]);

  const opts = await one<{ delete_sources_on_complete: boolean }>('select delete_sources_on_complete from public.batches where id = $1', [batch.id]);
  if (opts.delete_sources_on_complete && status === 'done') {
    await enqueue({ userId: batch.user_id, bookId: book.id, type: 'cleanup_sources', payload: { batchId: batch.id },
      dedupeKey: `cleanup_sources:${batch.id}` });
  }
  return { chunks: chunks.length, blocks: stale.length, review: reviewCount };
}

/** A page is translated when every block that came from it is; needs_review if any is flagged. */
export async function refreshPageStatuses(pageIds: string[]) {
  if (!pageIds.length) return;
  await query(
    `update public.pages p set status = s.status
     from (
       select pid as id,
              case when bool_or(b.status in ('needs_review', 'error')) then 'needs_review'
                   when bool_and(b.status = 'translated') then 'translated'
                   else 'translating' end as status
       from unnest($1::uuid[]) pid
       join public.blocks b on pid = any(b.page_ids)
       group by pid
     ) s
     where p.id = s.id and p.status in ('extracted', 'translating', 'translated', 'needs_review')`,
    [pageIds],
  );
}
