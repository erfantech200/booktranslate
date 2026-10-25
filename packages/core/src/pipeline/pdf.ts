import { join } from 'node:path';
import * as napi from '@napi-rs/canvas';
import { pdfjsRoot } from '../assets';

// PDFs are read with pdfjs-dist (pure JS) and rasterized with @napi-rs/canvas (prebuilt
// binaries), so this runs on Vercel functions as well as in the Docker worker; no
// poppler-utils needed. Each page is classified on its own: a usable text layer means no OCR.

type PdfDoc = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>['promise']>;
interface CanvasAndContext { canvas: napi.Canvas | null; context: napi.SKRSContext2D | null }

// pdfjs finds @napi-rs/canvas with a runtime require that bundlers can't see. Importing it here
// makes it part of the traced function, and we provide the globals and the canvas factory.
const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= napi.DOMMatrix;
g.Path2D ??= napi.Path2D;
g.ImageData ??= napi.ImageData;

class NapiCanvasFactory {
  constructor(_opts?: unknown) {}
  create(width: number, height: number): CanvasAndContext {
    const canvas = napi.createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc: CanvasAndContext, width: number, height: number) {
    cc.canvas!.width = Math.max(1, width);
    cc.canvas!.height = Math.max(1, height);
  }
  destroy(cc: CanvasAndContext) {
    if (cc.canvas) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    }
    cc.canvas = null;
    cc.context = null;
  }
}

async function openPdf<T>(pdf: Buffer, fn: (doc: PdfDoc) => Promise<T>): Promise<T> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = pdfjsRoot();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
    CanvasFactory: NapiCanvasFactory,
  });
  const doc = await task.promise;
  try {
    return await fn(doc);
  } finally {
    await task.destroy();
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  return openPdf(pdf, async (doc) => doc.numPages);
}

/** Text layer of each page, in page order. Lines are separated by newlines. */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  return openPdf(pdf, async (doc) => {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (item.str && !item.str.endsWith(' ')) text += ' ';
      }
      out.push(text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' '));
      page.cleanup();
    }
    return out;
  });
}

/**
 * Heuristic: a page has a usable text layer if it has enough real words. Scanned PDFs have no
 * text, or only OCR garbage and "(cid:123)"-style glyph references from broken font encodings.
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
export async function renderPdfPage(pdf: Buffer, pageNumber: number, dpi = 200): Promise<Buffer> {
  return openPdf(pdf, async (doc) => {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const factory = new NapiCanvasFactory();
    const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvas = target.canvas!;
    const context = target.context!;
    try {
      // White background: scanned pages with transparency would otherwise render black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as any, canvasContext: context as any, viewport }).promise;
      return Buffer.from(await canvas.encode('jpeg', 90));
    } finally {
      factory.destroy(target);
      page.cleanup();
    }
  });
}
