import { describe, expect, it } from 'vitest';
import { joinText, orderPages, qualityWarnings, stitch, type OrderablePage } from '../src/pipeline/assemble';
import { chunkBlocks, firstOccurrences, termsIn, translationHash } from '../src/pipeline/translate';
import { BookSettings, type PageExtraction } from '../src/types';
import { splitTextIntoPages } from '../src/pipeline/ingest';
import { hasUsableTextLayer } from '../src/pipeline/pdf';

const page = (id: string, o: Partial<OrderablePage> = {}): OrderablePage => ({
  id, printed_page_number: null, exif_taken_at: null, original_name: `${id}.jpg`, upload_index: 0, source_index: 0,
  parent_page_id: null, split_side: null, manual_order: false, ordinal: null, ...o,
});

describe('orderPages', () => {
  it('orders by printed page number, regardless of upload order', () => {
    const r = orderPages([page('a', { printed_page_number: 12 }), page('b', { printed_page_number: 10 }), page('c', { printed_page_number: 11 })], 'en');
    expect(r.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
  it('keeps unnumbered pages after the page that preceded them (EXIF time)', () => {
    const t = (m: number) => new Date(2026, 0, 1, 10, m);
    const r = orderPages([
      page('p20', { printed_page_number: 20, exif_taken_at: t(1) }),
      page('opener', { exif_taken_at: t(2) }),
      page('p22', { printed_page_number: 22, exif_taken_at: t(3) }),
      page('p19', { printed_page_number: 19, exif_taken_at: t(4) }),
    ], 'en');
    expect(r.map((p) => p.id)).toEqual(['p19', 'p20', 'opener', 'p22']);
  });
  it('falls back to EXIF time, then natural filename order', () => {
    expect(orderPages([page('x', { original_name: 'IMG_10.jpg' }), page('y', { original_name: 'IMG_9.jpg' })], 'en')
      .map((p) => p.id)).toEqual(['y', 'x']);
    expect(orderPages([page('x', { exif_taken_at: new Date(2) }), page('y', { exif_taken_at: new Date(1) })], 'en')
      .map((p) => p.id)).toEqual(['y', 'x']);
  });
  it('orders spread halves by reading direction', () => {
    const halves = [page('R', { parent_page_id: 'S', split_side: 'right' }), page('L', { parent_page_id: 'S', split_side: 'left' })];
    expect(orderPages(halves, 'en').map((p) => p.id)).toEqual(['L', 'R']);
    expect(orderPages(halves, 'fa').map((p) => p.id)).toEqual(['R', 'L']);
  });
  it('respects a manual order', () => {
    const r = orderPages([page('a', { manual_order: true, ordinal: 2, printed_page_number: 1 }), page('b', { manual_order: true, ordinal: 1, printed_page_number: 2 })], 'en');
    expect(r.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

const ex = (blocks: Partial<PageExtraction['blocks'][number]>[], n: number | null = null): PageExtraction => ({
  printed_page_number: n, is_spread: false,
  quality: { legibility: 1, cut_off: false, blur: false, glare: false },
  blocks: blocks.map((b, i) => ({ id: `b${i + 1}`, type: 'paragraph', level: null, text: '', footnote_marker: null,
    starts_mid_sentence: false, ends_mid_sentence: false, ...b })),
});

describe('stitch', () => {
  it('merges a paragraph split across pages, skipping footnotes in between', () => {
    const r = stitch([
      { id: 'p1', extraction: ex([{ text: 'The lamp had been lit since' , ends_mid_sentence: true }, { type: 'footnote', text: 'A note.', footnote_marker: '1' }]) },
      { id: 'p2', extraction: ex([{ text: 'the early afternoon.', starts_mid_sentence: true }, { text: 'Next one.' }]) },
    ], null);
    const body = r.blocks.filter((b) => b.type !== 'footnote');
    expect(body.map((b) => b.text)).toEqual(['The lamp had been lit since the early afternoon.', 'Next one.']);
    expect(body[0]!.page_ids).toEqual(['p1', 'p2']);
    expect(r.blocks.find((b) => b.type === 'footnote')!.footnote_marker).toBe('1');
  });
  it('removes hyphenation at the page break', () => {
    expect(joinText('a careful transla-', 'tion of it', 'paragraph')).toBe('a careful translation of it');
    expect(joinText('a well-', 'Known', 'paragraph')).toBe('a well- Known');
  });
  it('merges without model flags when punctuation says so', () => {
    const r = stitch([
      { id: 'p1', extraction: ex([{ text: 'She opened the door and' }]) },
      { id: 'p2', extraction: ex([{ text: 'walked into the hall.' }]) },
    ], null);
    expect(r.blocks).toHaveLength(1);
  });
  it('does not merge complete paragraphs or headings', () => {
    const r = stitch([
      { id: 'p1', extraction: ex([{ text: 'It ended there.' }]) },
      { id: 'p2', extraction: ex([{ type: 'heading', level: 1, text: 'Two' }]) },
    ], null);
    expect(r.blocks).toHaveLength(2);
  });
  it('continues a paragraph from the previous batch', () => {
    const r = stitch([{ id: 'p9', extraction: ex([{ text: 'rest of the sentence.', starts_mid_sentence: true }, { text: 'New.' }]) }],
      { id: 'old', type: 'paragraph', text: 'The beginning of', ends_mid_sentence: true, local_ids: ['p8#b3'] });
    expect(r.mergeIntoPrevious?.text).toBe('rest of the sentence.');
    expect(r.blocks.map((b) => b.text)).toEqual(['New.']);
  });
});

describe('qualityWarnings', () => {
  const q = (id: string, n: number | null, o: any = {}) => ({ id, printed_page_number: n, sha256: id, quality: null, blockCount: 3, status: 'extracted', ...o });
  it('finds gaps, duplicates, poor photos and batch overlap', () => {
    const w = qualityWarnings([
      q('a', 10), q('b', 11), q('c', 14), q('d', 14),
      q('e', 15, { quality: { legibility: 0.4, blur: true, glare: false, cut_off: true } }),
    ], 12);
    const codes = w.map((x) => x.code);
    expect(codes).toContain('missing_pages');
    expect(w.find((x) => x.code === 'missing_pages')!.message).toBe('Pages 12–13 are missing');
    expect(codes).toContain('duplicate_page');
    expect(codes).toEqual(expect.arrayContaining(['low_quality', 'blur', 'cut_off', 'overlaps_previous_batch']));
  });
});

describe('chunking & hashes', () => {
  // 'abcd' ≈ 1 token, so blk(n) ≈ n tokens (+12 per-block overhead in the chunker).
  const blk = (n: number, type = 'paragraph') => ({ source_text: 'abcd'.repeat(n), type });
  it('never splits blocks and respects the max', () => {
    const chunks = chunkBlocks([blk(1000), blk(1000), blk(800), blk(3000), blk(10)], 1500, 2500);
    expect(chunks.map((c) => c.length)).toEqual([2, 1, 1, 1]);
  });
  it('prefers breaking at headings once past the minimum', () => {
    const chunks = chunkBlocks([blk(1700), blk(5, 'heading'), blk(300)], 1500, 2500);
    expect(chunks.map((c) => c.length)).toEqual([1, 2]);
  });
  it('hash depends only on glossary terms occurring in the block', () => {
    const settings = BookSettings.parse({});
    const g = [{ source_term: 'Mara', target_term: 'مارا', locked: true, kind: 'character', notes: null }];
    const b = { source_hash: 'h', source_text: 'The river was wide.' };
    const base = { model: 'm', effort: 'medium', settings, firstOcc: [] };
    expect(translationHash(b, { ...base, glossary: [] })).toBe(translationHash(b, { ...base, glossary: g }));
    const b2 = { source_hash: 'h2', source_text: 'Mara crossed it.' };
    expect(translationHash(b2, { ...base, glossary: [] })).not.toBe(translationHash(b2, { ...base, glossary: g }));
    expect(termsIn('Marathon', g)).toEqual([]);
  });
  it('marks first occurrences of names', () => {
    const g = [{ source_term: 'Mara', target_term: 'مارا', locked: false, kind: 'character', notes: null }];
    const m = firstOccurrences([{ id: '1', source_text: 'No one.' }, { id: '2', source_text: 'Mara came.' }, { id: '3', source_text: 'Mara left.' }], g);
    expect([...m]).toEqual([['2', ['Mara']]]);
  });
});

describe('inputs', () => {
  it('splits plain text into pseudo pages at paragraph breaks', () => {
    const parts = splitTextIntoPages(Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${'x'.repeat(900)}`).join('\n\n'));
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => !p.startsWith('\n'))).toBe(true);
  });
  it('detects usable PDF text layers', () => {
    expect(hasUsableTextLayer('The quick brown fox jumps over the lazy dog. '.repeat(5))).toBe(true);
    expect(hasUsableTextLayer('')).toBe(false);
    expect(hasUsableTextLayer('(cid:12)(cid:44) '.repeat(40))).toBe(false);
    expect(hasUsableTextLayer('~ ^ | ] . , ; - '.repeat(30))).toBe(false);
  });
});
