import type { Browser } from 'playwright-core';
import { pageSizes, type PageSizeKey } from '../config';
import { toPersianDigits } from '../lint/fa';
import { buildDocument, escapeXml, formatNum, type BuiltDocument, type RenderBook } from './document';
import { fontDataUrl, fontFaceCss, fontStack } from './fonts';

export interface PdfOptions {
  pageSize: PageSizeKey;
  bodyFont: 'naskh' | 'vazirmatn';
  fontSizePt: number;
  grayscale: boolean;
}

const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

export function frontMatterStrings(book: RenderBook) {
  const fa = book.lang === 'fa';
  const date = new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-GB', { year: 'numeric', month: 'long' }).format(book.date);
  return {
    toc: fa ? 'فهرست' : 'Contents',
    translatorLine: book.translator ? (fa ? `ترجمهٔ ${book.translator}` : `Translated by ${book.translator}`) : null,
    authorLine: book.author,
    date,
    notes: fa ? 'یادداشت‌ها' : 'Notes',
    untranslated: fa ? '(ترجمه نشده)' : '(untranslated)',
  };
}

export function bookCss(doc: BuiltDocument, book: RenderBook, o: PdfOptions, fontSrc: 'data' | 'epub'): string {
  const rtl = doc.dir === 'rtl';
  const fonts = fontStack(o.bodyFont, rtl);
  const accent = o.grayscale ? '#000' : '#1f3a5f';
  const muted = o.grayscale ? '#444' : '#5b6472';
  const lh = rtl ? 1.9 : 1.5;
  return `
${fontFaceCss((f) => (fontSrc === 'data' ? fontDataUrl(f) : `fonts/${f.file}`))}
:root { --accent: ${accent}; --muted: ${muted}; }
html { font-family: ${fonts.body}; font-size: ${o.fontSizePt}pt; line-height: ${lh}; color: #111; }
body { margin: 0; text-rendering: optimizeLegibility; font-kerning: normal; }
p { margin: 0; text-align: justify; text-justify: inter-word; orphans: 2; widows: 2; }
p + p { text-indent: 1.5em; }
h1, h2, h3, h4 { font-family: ${fonts.alt}; color: var(--accent); line-height: 1.4; break-after: avoid; page-break-after: avoid; text-align: start; }
h1 { font-size: 1.7em; margin: 0 0 1.6em; }
h2 { font-size: 1.25em; margin: 1.6em 0 0.6em; }
h3, h4 { font-size: 1.08em; margin: 1.3em 0 0.5em; }
h1 + p, h2 + p, h3 + p, h4 + p, blockquote + p, .poem + p, ul + p, .table + p { text-indent: 0; }
${rtl ? `em { font-style: normal; font-family: ${fonts.alt}; }` : ''}
blockquote { margin: 1em 2em; font-size: 0.95em; }
blockquote p { text-indent: 0; }
.poem { margin: 1em 0; text-align: center; break-inside: avoid; }
.poem p.verse { text-align: center; text-indent: 0; }
ul { margin: 0.6em 0; padding-inline-start: 1.6em; }
li { text-align: justify; }
.caption { font-size: 0.85em; color: var(--muted); text-align: center; text-indent: 0; margin: 0.5em 0; }
.table table { border-collapse: collapse; margin: 1em auto; font-size: 0.9em; }
.table td, .table th { border: 0.5pt solid #999; padding: 0.2em 0.5em; }
.untranslated { color: var(--muted); }
sup.fnref { font-size: 0.7em; line-height: 0; vertical-align: super; }
sup.fnref a, a.note-num { color: inherit; text-decoration: none; }
.notes { margin-top: 2.5em; border-top: 0.5pt solid #999; padding-top: 0.6em; font-size: 0.85em; }
.notes::before { content: ${cssString(frontMatterStrings(book).notes)}; display: block; font-family: ${fonts.alt}; color: var(--accent); margin-bottom: 0.4em; }
.notes aside p { text-indent: 0; margin-bottom: 0.3em; }
${fontSrc === 'data' ? '[dir="ltr"] { unicode-bidi: isolate; }' : '' /* EPUB CSS forbids unicode-bidi; dir= isolates there */}
`;
}

function printCss(book: RenderBook, o: PdfOptions): string {
  const ps = pageSizes[o.pageSize];
  const m = ps.margins;
  const rtl = book.lang === 'fa' || ['ar', 'he', 'ur'].includes(book.lang);
  const counter = book.lang === 'fa' ? 'counter(page, persian)' : book.lang === 'ar' ? 'counter(page, arabic-indic)' : 'counter(page)';
  const left = book.author ?? book.title;
  const right = book.title;
  const box = `font-family: inherit; font-size: 8.5pt; color: ${o.grayscale ? '#333' : '#5b6472'};`;
  return `
@page { size: ${ps.widthMm}mm ${ps.heightMm}mm; margin: ${m.top}mm ${m.outer}mm ${m.bottom}mm ${m.inner}mm; }
/* Mirrored margins: the inner (gutter) margin is always next to the spine. */
@page :right { margin-left: ${m.inner}mm; margin-right: ${m.outer}mm; }
@page :left { margin-left: ${m.outer}mm; margin-right: ${m.inner}mm; }
@page chapter:right {
  @top-center { content: ${cssString(right)}; ${box} }
  @bottom-center { content: ${counter}; ${box} }
}
@page chapter:left {
  @top-center { content: ${cssString(left)}; ${box} }
  @bottom-center { content: ${counter}; ${box} }
}
@page chapter:first { @top-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: none; } }
.front { page: front; }
.chapter { page: chapter; break-before: page; }
.title-page { height: ${ps.heightMm - m.top - m.bottom - 2}mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; break-after: page; }
.title-page .title { font-family: ${fontStack(o.bodyFont, rtl).alt}; font-size: 2.2em; font-weight: 700; color: var(--accent); line-height: 1.5; }
.title-page .author { font-size: 1.25em; margin-top: 0.8em; }
.title-page .translator { margin-top: 2.5em; }
.title-page .date { margin-top: 0.4em; color: var(--muted); font-size: 0.9em; }
.toc { break-after: page; }
.toc .toc-title { font-family: ${fontStack(o.bodyFont, rtl).alt}; color: var(--accent); font-size: 1.4em; margin-bottom: 1em; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { display: flex; align-items: baseline; gap: 0.4em; margin: 0.25em 0; }
.toc li.sub { padding-inline-start: 1.5em; font-size: 0.92em; }
.toc a { color: inherit; text-decoration: none; }
.toc .dots { flex: 1; border-bottom: 1px dotted #888; transform: translateY(-0.3em); }
.toc .num { min-width: 2.5em; text-align: end; }
${rtl ? '' : ''}
`;
}

export function bookHtml(book: RenderBook, o: PdfOptions, tocPages: Map<string, number> | null): { html: string; doc: BuiltDocument } {
  const doc = buildDocument(book);
  const s = frontMatterStrings(book);
  const num = (id: string) => {
    const n = tocPages?.get(id);
    return n === undefined ? (book.lang === 'fa' ? toPersianDigits('000') : '000') : formatNum(n, book.lang);
  };
  const tocItems = doc.chapters.filter((c) => c.title).flatMap((c) => [
    `<li><a href="#${c.id}">${c.titleHtml}</a><span class="dots"></span><span class="num">${num(c.id)}</span></li>`,
    ...c.headings.filter((h) => h.level === 2).map((h) =>
      `<li class="sub"><a href="#${h.id}">${escapeXml(h.text)}</a><span class="dots"></span><span class="num">${num(h.id)}</span></li>`),
  ]);
  const html = `<!doctype html>
<html lang="${doc.lang}" dir="${doc.dir}">
<head><meta charset="utf-8"><title>${escapeXml(book.title)}</title>
<style>${bookCss(doc, book, o, 'data')}${printCss(book, o)}</style></head>
<body>
<section class="front title-page">
  <div class="title">${escapeXml(book.title)}</div>
  ${s.authorLine ? `<div class="author">${escapeXml(s.authorLine)}</div>` : ''}
  ${s.translatorLine ? `<div class="translator">${escapeXml(s.translatorLine)}</div>` : ''}
  <div class="date">${escapeXml(s.date)}</div>
</section>
${tocItems.length ? `<nav class="front toc"><div class="toc-title">${s.toc}</div><ol>${tocItems.join('\n')}</ol></nav>` : ''}
${doc.chapters.map((c) => `<section class="chapter" id="${c.id}">
${c.titleHtml ? `<h1>${c.titleHtml}</h1>` : ''}
${c.bodyHtml}
${c.notesHtml}
</section>`).join('\n')}
</body></html>`;
  return { html: html.replaceAll(' epub:type="noteref"', '').replaceAll(' epub:type="footnotes"', '').replaceAll(' epub:type="footnote"', ''), doc };
}

/**
 * Page index (1-based) of every heading, read from the PDF outline Chromium generates from
 * h1–h3. Outline order = document order, so it is matched against chapter/section ids in order.
 */
async function headingPages(pdf: Buffer, doc: BuiltDocument): Promise<Map<string, number>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const pdfDoc = await task.promise;
  try {
    const outline = (await pdfDoc.getOutline()) ?? [];
    const flat: any[] = [];
    const walk = (items: any[]) => items.forEach((i) => { flat.push(i); if (i.items?.length) walk(i.items); });
    walk(outline);
    const ids = doc.chapters.flatMap((c) => [
      ...(c.title ? [c.id] : []),
      ...c.headings.filter((h) => h.level <= 3).map((h) => h.id),
    ]);
    const out = new Map<string, number>();
    for (let i = 0; i < Math.min(ids.length, flat.length); i++) {
      let dest = flat[i].dest;
      if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      out.set(ids[i]!, (await pdfDoc.getPageIndex(dest[0])) + 1);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/**
 * On Vercel (and other serverless hosts) there is no system Chromium: use the slim build from
 * @sparticuz/chromium. Elsewhere (Docker worker, local dev, tests) use Playwright's browser.
 */
async function launch(): Promise<Browser> {
  // Loaded on first use, so OCR/translation never depend on the browser package being loadable.
  const { chromium } = await import('playwright-core');
  const serverless = !!process.env.VERCEL || process.env.CHROMIUM_PACK === 'sparticuz';
  if (!serverless) return chromium.launch({ args: ['--font-render-hinting=none'] });
  const { default: slim } = await import('@sparticuz/chromium');
  slim.setGraphicsMode = false;
  return chromium.launch({
    executablePath: await slim.executablePath(),
    // Playwright doesn't support --single-process (closing a page can kill the browser), and
    // Vercel functions don't need it.
    args: [...slim.args.filter((a) => a !== '--single-process'), '--font-render-hinting=none'],
    headless: true,
  });
}

let sharedBrowser: Promise<Browser> | null = null;
export function browser(): Promise<Browser> {
  sharedBrowser ??= launch().catch((err) => {
    sharedBrowser = null;
    throw err;
  });
  return sharedBrowser;
}
export async function closeBrowser() {
  if (sharedBrowser) await (await sharedBrowser).close().catch(() => {});
  sharedBrowser = null;
}

async function printOnce(html: string): Promise<Buffer> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
  } finally {
    await page.close();
  }
}

/** Two passes: render, read heading page numbers from the outline, render again with a filled TOC. */
export async function renderPdf(book: RenderBook, o: PdfOptions): Promise<{ pdf: Buffer; pageCount: number }> {
  const first = bookHtml(book, o, null);
  let pdf = await printOnce(first.html);
  if (first.doc.chapters.some((c) => c.title)) {
    const pages = await headingPages(pdf, first.doc);
    pdf = await printOnce(bookHtml(book, o, pages).html);
  }
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { pdf, pageCount };
}
