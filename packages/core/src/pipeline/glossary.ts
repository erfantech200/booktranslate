import { stageModel } from '../config.js';
import { estimateTokens } from '../cost.js';
import { one, query } from '../db/pool.js';
import { hashOf } from '../hash.js';
import { autoFix } from '../lint/index.js';
import { InvalidModelOutputError, structuredCall } from '../openai/structured.js';
import { glossaryPrompt, PROMPT_VERSIONS } from '../prompts.js';
import { enqueue } from '../queue.js';
import { GlossaryOutput, parseBookSettings, type BookBrief } from '../types.js';
import { loadBatch } from './ingest.js';
import type { JobContext } from './context.js';

const EXCERPT_TOKENS = 12_000;

/** Beginning of the batch plus evenly spaced samples, capped at ~12k tokens. */
export function buildExcerpt(texts: string[], maxTokens = EXCERPT_TOKENS): string {
  const total = texts.reduce((n, t) => n + estimateTokens(t), 0);
  if (total <= maxTokens) return texts.join('\n\n');
  const out: string[] = [];
  let used = 0;
  const step = Math.max(1, Math.floor(texts.length / Math.max(1, Math.floor(maxTokens / 300))));
  for (let i = 0; i < texts.length && used < maxTokens; i += i < 20 ? 1 : step) {
    const t = texts[i]!;
    used += estimateTokens(t);
    out.push(t);
  }
  return out.join('\n\n');
}

export async function glossaryBatch(ctx: JobContext, batchId: string) {
  const batch = await loadBatch(batchId, ctx.job.user_id);
  const book = await one<{ id: string; source_lang: string; target_lang: string; settings: unknown; brief: BookBrief | null; title: string; author: string | null }>(
    'select id, source_lang, target_lang, settings, brief, title, author from public.books where id = $1', [batch.book_id]);
  const settings = parseBookSettings(book.settings);
  const sm = stageModel('glossary');

  const texts = (await query<{ source_text: string }>(
    `select source_text from public.blocks where batch_id = $1 and type <> 'footnote' order by ordinal`, [batch.id],
  )).map((r) => r.source_text);
  const existing = await query<{ source_term: string; target_term: string; kind: string; notes: string | null; locked: boolean }>(
    'select source_term, target_term, kind, notes, locked from public.glossary_terms where book_id = $1 order by source_term',
    [book.id],
  );
  const excerpt = buildExcerpt(texts);
  const hash = hashOf({ excerpt, model: sm.model, effort: sm.effort, prompt: PROMPT_VERSIONS.glossary,
    existing: existing.map((e) => e.source_term.toLowerCase()), settings: [settings.dialogueRegister] });

  const current = await one<{ glossary_hash: string | null }>('select glossary_hash from public.batches where id = $1', [batch.id]);
  if (current.glossary_hash !== hash && excerpt.trim()) {
    const existingList = existing.length
      ? existing.map((e) => `- ${e.source_term} → ${e.target_term} (${e.kind}${e.locked ? ', LOCKED' : ''})${e.notes ? ` — ${e.notes}` : ''}`).join('\n')
      : '(none yet: this is the first batch)';
    try {
      const r = await structuredCall({
        transport: ctx.deps.transport, hooks: ctx.deps.hooks,
        ctx: { userId: batch.user_id, bookId: book.id, batchId: batch.id, jobId: ctx.job.id },
        stage: 'glossary', model: sm.model, effort: sm.effort, schema: GlossaryOutput, schemaName: 'glossary',
        instructions: glossaryPrompt(book.source_lang, book.target_lang, settings),
        input: [{
          role: 'user',
          content: `Book: ${book.title}${book.author ? ` by ${book.author}` : ''}\n\nExisting glossary:\n${existingList}\n\nExcerpt:\n"""\n${excerpt}\n"""`,
        }],
        cacheKey: `glossary:${book.id}`,
      });
      const known = new Set(existing.map((e) => e.source_term.toLowerCase()));
      for (const t of r.value.terms) {
        const src = t.source_term.trim();
        const tgt = autoFix(book.target_lang, t.target_term, { persianDigits: false }).text;
        if (!src || !tgt || known.has(src.toLowerCase()) || src.length > 200 || tgt.length > 200) continue;
        known.add(src.toLowerCase());
        await query(
          `insert into public.glossary_terms (user_id, book_id, source_term, target_term, kind, notes, origin, first_seen_batch_id)
           values ($1,$2,$3,$4,$5,$6,'auto',$7)
           on conflict (book_id, lower(source_term)) do nothing`,
          [batch.user_id, book.id, src, tgt, t.kind, t.notes?.slice(0, 1000) ?? null, batch.id],
        );
      }
      // The brief is part of the cached prompt prefix; keep it stable once set (fill gaps only).
      const merged = book.brief
        ? Object.fromEntries(Object.entries(r.value.brief).map(([k, v]) => [k, (book.brief as any)[k] || v]))
        : r.value.brief;
      await query('update public.books set brief = $2 where id = $1', [book.id, JSON.stringify(merged)]);
    } catch (err) {
      // A glossary is helpful but not required: translate without new terms rather than stall.
      if (!(err instanceof InvalidModelOutputError)) throw err;
      ctx.log('glossary output invalid; continuing without new terms', { issues: err.issues });
    }
    await query('update public.batches set glossary_hash = $2 where id = $1', [batch.id, hash]);
  }

  await query(`update public.batches set stage = 'translate', status = 'translating' where id = $1`, [batch.id]);
  await enqueue({ userId: batch.user_id, bookId: book.id, type: 'translate_batch',
    payload: { batchId: batch.id }, dedupeKey: `translate_batch:${batch.id}` });
  return { terms: existing.length };
}
