import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDocument, inlineHtml } from '../src/render/document.js';
import { closeBrowser, renderPdf } from '../src/render/pdf.js';
import { renderEpub } from '../src/render/epub.js';
import { sampleBook } from './fixtures/sampleBook.js';

const tmp = mkdtempSync(join(tmpdir(), 'bb-render-'));
afterAll(() => closeBrowser());

describe('document model', () => {
  it('splits chapters at level-1 headings and numbers footnotes per chapter', () => {
    const doc = buildDocument(sampleBook());
    expect(doc.dir).toBe('rtl');
    expect(doc.chapters.map((c) => c.title)).toEqual(['فصل یکم: ایستگاه', 'فصل دوم: باغ']);
    const ch1 = doc.chapters[0]!;
    expect(ch1.bodyHtml).toContain('href="#ch1-fn1"');
    expect(ch1.notesHtml).toContain('id="ch1-fn1"');
    expect(ch1.notesHtml).toContain('—م.'); // translator note suffix
    expect(ch1.bodyHtml).toContain('<ul>');
    expect(ch1.bodyHtml).toContain('class="verse"');
  });
  it('isolates Latin runs and escapes HTML', () => {
    expect(inlineHtml('روزنامهٔ *Morning Post* <b>', { rtl: true, sourceLang: 'en' }))
      .toBe('روزنامهٔ <em><span dir="ltr" lang="en">Morning Post</span></em> &lt;b&gt;');
  });
});

describe('PDF', () => {
  it('renders an RTL A5 PDF with embedded fonts; page 1 renders to PNG', async () => {
    const { pdf, pageCount } = await renderPdf(sampleBook(), { pageSize: 'A5', bodyFont: 'naskh', fontSizePt: 11.5, grayscale: false });
    const file = join(tmp, 'book.pdf');
    writeFileSync(file, pdf);
    expect(pageCount).toBeGreaterThanOrEqual(4);

    // Embedded fonts: every font in the file is embedded (emb = yes) and Naskh is among them.
    const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((l) => / yes +yes /.test(l))).toBe(true);
    expect(fonts.some((l) => l.includes('NotoNaskhArabic'))).toBe(true);

    // A5 = 148×210 mm = 419.5×595.3 pt.
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
    expect(info).toMatch(/Page size:\s+(419|420)(\.\d+)? x (594|595)(\.\d+)? pts/);

    // Text extraction keeps Persian and Persian page digits.
    const text = execFileSync('pdftotext', ['-f', '3', '-l', '3', file, '-'], { encoding: 'utf8' });
    expect(text).toMatch(/[؀-ۿ]/);

    // Page 1 → PNG. RTL check: the title page is centred, so check page 3 (body text): ink must
    // hug the right margin — the right edge of text lines is aligned, the left edge is ragged
    // only on last lines. Measure that the rightmost ink column is closer to the right edge
    // than the leftmost to the left edge on a short final line (justified RTL).
    execFileSync('pdftoppm', ['-r', '60', '-f', '1', '-l', '1', '-png', file, join(tmp, 'page')]);
    const png = join(tmp, 'page-1.png');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBeGreaterThan(200);

    execFileSync('pdftoppm', ['-r', '60', '-f', '3', '-l', '3', '-png', file, join(tmp, 'body')]);
    const { data, info: im } = await sharp(join(tmp, 'body-3.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
    // Find rows with ink; for each row compute leftmost/rightmost dark pixel.
    const rows: { l: number; r: number }[] = [];
    for (let y = Math.floor(im.height * 0.25); y < im.height * 0.9; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < im.width; x++) if (data[y * im.width + x]! < 120) { if (l < 0) l = x; r = x; }
      if (l >= 0) rows.push({ l, r });
    }
    const rightEdges = rows.map((r) => r.r);
    const leftEdges = rows.map((r) => r.l);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    // RTL: lines start on the right, so right edges vary less than left edges (ragged left).
    expect(spread(rightEdges)).toBeLessThan(spread(leftEdges));
  });
});

describe('EPUB', () => {
  it('is a valid EPUB 3 with RTL progression and embedded fonts (epubcheck)', async () => {
    const buf = await renderEpub(sampleBook(), { bodyFont: 'naskh', fontSizePt: 11 });
    const file = join(tmp, 'book.epub');
    writeFileSync(file, buf);
    const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
    expect(list).toContain('OEBPS/fonts/NotoNaskhArabic-arabic-400.woff2');
    const opf = execFileSync('unzip', ['-p', file, 'OEBPS/content.opf'], { encoding: 'utf8' });
    expect(opf).toContain('page-progression-direction="rtl"');
    const ch = execFileSync('unzip', ['-p', file, 'OEBPS/ch1.xhtml'], { encoding: 'utf8' });
    expect(ch).toContain('dir="rtl"');
    expect(ch).toContain('xml:lang="fa"');
    expect(ch).toContain('epub:type="noteref"');
    expect(ch).toContain('epub:type="footnote"');

    if (process.env.SKIP_EPUBCHECK) return;
    const { epubcheck } = await import('../scripts/epubcheck.js');
    const r = epubcheck(file);
    expect(r.output).toContain('No errors or warnings detected');
    expect(r.ok).toBe(true);
  });
});

mkdirSync(tmp, { recursive: true });
