import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// PDFs are handled with poppler-utils (pdfinfo / pdftotext / pdftoppm), which the worker image
// installs. Each page is classified on its own: a usable text layer means no OCR is needed.

const run = promisify(execFile);

async function withTmpPdf<T>(pdf: Buffer, fn: (file: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bb-pdf-'));
  const file = join(dir, 'in.pdf');
  await writeFile(file, pdf);
  try {
    return await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  return withTmpPdf(pdf, async (file) => {
    const { stdout } = await run('pdfinfo', [file]);
    const m = /Pages:\s+(\d+)/.exec(stdout);
    if (!m) throw new Error('pdfinfo: page count not found');
    return Number(m[1]);
  });
}

/** Text layer of each page (1-based page index → text). One pdftotext call per document. */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  return withTmpPdf(pdf, async (file) => {
    const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', '-eol', 'unix', file, '-'], {
      maxBuffer: 256 * 1024 * 1024,
    });
    // pdftotext separates pages with form feeds; the last one is trailing.
    const pages = stdout.split('\f');
    if (pages.length > 1 && pages[pages.length - 1]!.trim() === '') pages.pop();
    return pages;
  });
}

/**
 * Heuristic: a page has a usable text layer if it has enough real words. Scanned PDFs have no
 * text or only OCR garbage / "(cid:123)" glyph references from broken font encodings.
 */
export function hasUsableTextLayer(text: string): boolean {
  const t = text.trim();
  if (t.length < 80) return false;
  if (/\(cid:\d+\)/.test(t)) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const nonSpace = t.replace(/\s/g, '').length;
  if (nonSpace === 0 || letters / nonSpace < 0.6) return false;
  const words = t.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  const avg = words.reduce((n, w) => n + w.length, 0) / Math.max(1, words.length);
  return words.length >= 15 && avg >= 2.5 && avg <= 14;
}

/** Rasterize one page (1-based) to JPEG at the given DPI for OCR. */
export async function renderPdfPage(pdf: Buffer, page: number, dpi = 200): Promise<Buffer> {
  return withTmpPdf(pdf, async (file, dir) => {
    await run('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(dpi), '-jpeg',
      '-jpegopt', 'quality=90', file, join(dir, 'p')]);
    const out = (await readdir(dir)).find((f) => f.startsWith('p') && f.endsWith('.jpg'));
    if (!out) throw new Error(`pdftoppm produced no image for page ${page}`);
    return readFile(join(dir, out));
  });
}
