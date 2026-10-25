import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, query } from '../../src/db/pool.js';
import { env } from '../../src/config.js';
import { enqueue } from '../../src/queue.js';
import { drain } from '../../src/runner.js';
import { LocalStorage } from '../../src/storage.js';
import { dbCallHooks } from '../../src/usage.js';
import { normalizeImage, splitSpread } from '../../src/pipeline/image.js';
import { renderPdfPage } from '../../src/pipeline/pdf.js';
import { closeBrowser } from '../../src/render/pdf.js';
import { FakeTransport } from '../fakeModel.js';
import { createBatch, createBook, createUser, RUN } from './helpers.js';

const FIX = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'generated');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!RUN || !existsSync(join(FIX, 'manifest.json')))('golden pipeline (fixtures → Persian PDF + EPUB)', () => {
  const storage = new LocalStorage(mkdtempSync(join(tmpdir(), 'bb-store-')));
  let transport: FakeTransport;
  let user: string;
  let book: string;
  const log = () => {};

  beforeAll(async () => {
    // Map the exact bytes the pipeline will send for each page image → fixture pages.
    const map = new Map<string, { pages: number[]; spread: boolean }>();
    const manifest = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8')) as Record<string, { pages: number[] }>;
    for (const [file, m] of Object.entries(manifest)) {
      if (file.endsWith('.jpg')) {
        const n = await normalizeImage(readFileSync(join(FIX, file)), env().OCR_MAX_IMAGE_PX);
        map.set(sha(n.normalized), { pages: m.pages, spread: m.pages.length === 2 });
        if (m.pages.length === 2) {
          const [l, r] = await splitSpread(n.normalized);
          map.set(sha(l), { pages: [m.pages[0]!], spread: false });
          map.set(sha(r), { pages: [m.pages[1]!], spread: false });
        }
      } else if (file === 'scanned.pdf') {
        const pdf = readFileSync(join(FIX, file));
        for (let i = 0; i < m.pages.length; i++) {
          const n = await normalizeImage(await renderPdfPage(pdf, i + 1), env().OCR_MAX_IMAGE_PX);
          map.set(sha(n.normalized), { pages: [m.pages[i]!], spread: false });
        }
      }
    }
    transport = new FakeTransport(map);
    user = await createUser('golden@example.com');
    book = await createBook(user, { title: 'The Lantern Keeper', translator: 'Erfan' });
    await query(`update public.books set settings = '{"pageSize":"A5"}' where id = $1`, [book]);
  });
  afterAll(() => closeBrowser());

  const deps = () => ({ storage, transport, hooks: dbCallHooks });

  async function upload(batch: string, files: string[]) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const path = `${user}/${book}/${batch}/${i}-${f}`;
      await storage.upload('sources', path, readFileSync(join(FIX, f)), 'application/octet-stream');
      await query(
        `insert into public.source_files (user_id, book_id, batch_id, storage_path, original_name, kind, upload_index)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [user, book, batch, path, f, f.endsWith('.pdf') ? 'pdf' : 'image', i]);
    }
    await enqueue({ userId: user, bookId: book, type: 'ingest_batch', payload: { batchId: batch }, dedupeKey: `ingest_batch:${batch}` });
  }

  it('batch 1: photos (spread, skewed, blurry) + scanned PDF → ordered, stitched, translated', async () => {
    const batch = await createBatch(user, book, 1);
    // Filenames/upload order deliberately differ from page order.
    await upload(batch, ['IMG_2041.jpg', 'IMG_2039.jpg', 'IMG_2040.jpg', 'IMG_2042.jpg', 'IMG_2043.jpg', 'scanned.pdf']);
    await drain(deps(), { workerId: 'test', log });

    const jobs = await query(`select type, status, last_error from public.jobs where book_id = $1 and status <> 'done'`, [book]);
    expect(jobs).toEqual([]);

    const pages = await query<{ printed_page_number: number | null; status: string; split_side: string | null; warnings: any[] }>(
      `select printed_page_number, status, split_side, warnings from public.pages where batch_id = $1 and status <> 'split' order by ordinal`, [batch]);
    expect(pages.map((p) => p.printed_page_number)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
    expect(pages.every((p) => p.status === 'translated')).toBe(true);
    expect(pages.filter((p) => p.split_side).map((p) => p.split_side)).toEqual(['left', 'right']);
    expect(pages.find((p) => p.printed_page_number === 46)!.warnings.map((w: any) => w.code)).toEqual(expect.arrayContaining(['low_quality', 'blur']));
    expect((await one(`select count(*)::int n from public.pages where batch_id = $1 and status = 'split'`, [batch])).n).toBe(1);

    const blocks = await query<{ type: string; source_text: string; translated_text: string; page_ids: string[]; status: string }>(
      `select type, source_text, translated_text, page_ids, status from public.blocks where batch_id = $1 order by ordinal`, [batch]);
    const merged = blocks.find((b) => b.source_text.startsWith('On the night the letter arrived'))!;
    expect(merged.source_text).toContain('moving faster than any boat could hope to.');
    expect(merged.page_ids).toHaveLength(2);
    expect(blocks.filter((b) => b.type === 'footnote')).toHaveLength(1);
    expect(blocks.filter((b) => b.type === 'heading').map((b) => b.source_text)).toEqual(['Chapter Four: The Crossing']);
    expect(blocks.every((b) => b.status === 'translated' && /[؀-ۿ]/.test(b.translated_text))).toBe(true);
    expect(blocks.every((b) => !/[A-Za-z]{3,}/.test(b.translated_text.replace(/\[\^\d+\]/g, '')))).toBe(true);
    // Glossary rendering + Persian lint (ی/ک, guillemets) applied.
    expect(blocks.some((b) => b.translated_text.includes('ایلزه وارگا'))).toBe(true);
    expect(blocks.find((b) => b.source_text.startsWith('“Come before'))!.translated_text).toMatch(/^«.*»/);

    const terms = await query('select source_term from public.glossary_terms where book_id = $1', [book]);
    expect(terms.length).toBe(4);
    const b = await one('select status, warnings from public.batches where id = $1', [batch]);
    expect(b.status).toBe('done');

    const cost = await one<{ n: number; usd: string; stages: string[] }>(
      `select count(*)::int n, sum(cost_usd) usd, array_agg(distinct stage) stages from public.usage_log where book_id = $1`, [book]);
    expect(cost.stages.sort()).toEqual(['glossary', 'ocr', 'translate']);
    expect(Number(cost.usd)).toBeGreaterThan(0);
  });

  it('re-running translation is a no-op (content hashes)', async () => {
    const batch = (await one(`select id from public.batches where book_id = $1 and seq = 1`, [book])).id;
    const before = (await one('select count(*)::int n from public.usage_log where book_id = $1', [book])).n;
    await enqueue({ userId: user, bookId: book, type: 'translate_batch', payload: { batchId: batch } });
    await enqueue({ userId: user, bookId: book, type: 'extract_page', payload: {
      pageId: (await one(`select id from public.pages where batch_id = $1 and printed_page_number = 41`, [batch])).id } });
    await drain(deps(), { workerId: 'test', log });
    expect((await one('select count(*)::int n from public.usage_log where book_id = $1', [book])).n).toBe(before);
  });

  it('user overrides survive re-runs; editing a locked glossary term retranslates only affected blocks', async () => {
    const batch = (await one(`select id from public.batches where book_id = $1 and seq = 1`, [book])).id;
    const target = await one<{ id: string }>(`select id from public.blocks where batch_id = $1 and source_text like 'She packed one bag%'`, [batch]);
    await query(`update public.blocks set user_override = 'ویرایش من', override_at = now() where id = $1`, [target.id]);
    await query(`update public.glossary_terms set target_term = 'سِلبی', locked = true where book_id = $1 and source_term = 'Selby'`, [book]);
    const before = (await one(`select count(*)::int n from public.usage_log where book_id = $1 and stage = 'translate'`, [book])).n;
    await enqueue({ userId: user, bookId: book, type: 'translate_batch', payload: { batchId: batch } });
    await drain(deps(), { workerId: 'test', log });
    const after = (await one(`select count(*)::int n from public.usage_log where book_id = $1 and stage = 'translate'`, [book])).n;
    expect(after - before).toBe(1); // one chunk: only the block mentioning Selby
    expect((await one('select user_override from public.blocks where id = $1', [target.id])).user_override).toBe('ویرایش من');
    expect((await one(`select translated_text from public.blocks where batch_id = $1 and source_text like 'By noon%'`, [batch])).translated_text).toContain('سِلبی');
  });

  it('batch 2: text-layer PDF is structured without OCR and appended after batch 1', async () => {
    const batch = await createBatch(user, book, 2);
    const ocrBefore = (await one(`select count(*)::int n from public.usage_log where book_id = $1 and stage = 'ocr'`, [book])).n;
    await upload(batch, ['text.pdf']);
    await drain(deps(), { workerId: 'test', log });
    const pages = await query(`select printed_page_number, extraction_method, status from public.pages where batch_id = $1 order by ordinal`, [batch]);
    expect(pages.map((p) => [p.printed_page_number, p.extraction_method, p.status])).toEqual([[49, 'text_layer', 'translated'], [50, 'text_layer', 'translated']]);
    expect((await one(`select count(*)::int n from public.usage_log where book_id = $1 and stage = 'ocr'`, [book])).n).toBe(ocrBefore);
    expect((await one(`select count(*)::int n from public.usage_log where book_id = $1 and stage = 'structure'`, [book])).n).toBe(2);
    const order = await query(`select b.seq from public.blocks k join public.batches b on b.id = k.batch_id where k.book_id = $1 order by k.ordinal`, [book]);
    expect(order.map((r) => r.seq)).toEqual([...order.map((r) => r.seq)].sort());
  });

  it('exports a Persian PDF (A5) and a valid EPUB; identical re-export is served from cache', async () => {
    const mk = async (format: string) => (await one<{ id: string }>(
      `insert into public.exports (user_id, book_id, format, options) values ($1,$2,$3,'{"pageSize":"A5"}') returning id`, [user, book, format])).id;
    const pdfId = await mk('pdf');
    const epubId = await mk('epub');
    for (const id of [pdfId, epubId]) await enqueue({ userId: user, bookId: book, type: 'render_export', payload: { exportId: id } });
    await drain(deps(), { workerId: 'test', log });

    const pdf = await one(`select status, storage_path, page_count, error from public.exports where id = $1`, [pdfId]);
    expect(pdf).toMatchObject({ status: 'done', error: null });
    expect(pdf.page_count).toBeGreaterThanOrEqual(3);
    const pdfBytes = await storage.download('exports', pdf.storage_path);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    const out = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'out');
    if (existsSync(out)) writeFileSync(join(out, 'golden.pdf'), pdfBytes);

    const epub = await one(`select status, storage_path from public.exports where id = $1`, [epubId]);
    expect(epub.status).toBe('done');
    const epubFile = join(mkdtempSync(join(tmpdir(), 'bb-epub-')), 'golden.epub');
    writeFileSync(epubFile, await storage.download('exports', epub.storage_path));
    if (!process.env.SKIP_EPUBCHECK) {
      const { epubcheck } = await import('../../scripts/epubcheck.js');
      const r = epubcheck(epubFile);
      expect(r.output).toContain('No errors or warnings detected');
    }

    const again = await mk('pdf');
    await enqueue({ userId: user, bookId: book, type: 'render_export', payload: { exportId: again } });
    await drain(deps(), { workerId: 'test', log });
    expect((await one('select storage_path from public.exports where id = $1', [again])).storage_path).toBe(pdf.storage_path);
  });
});
