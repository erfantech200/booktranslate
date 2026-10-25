import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Vendored OFL fonts (see scripts/vendor-fonts.ts). Each script subset gets its own family name
// so per-glyph fallback works through the font-family stack without unicode-range bookkeeping.

export const FONTS_DIR = process.env.FONTS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

export interface FontFile {
  family: string;
  file: string;
  weight: 400 | 700;
  style: 'normal' | 'italic';
}

export const FONT_FILES: FontFile[] = [400, 700].flatMap((w) => [
  { family: 'BB Naskh', file: `NotoNaskhArabic-arabic-${w}.woff2`, weight: w, style: 'normal' },
  { family: 'BB Naskh Latin', file: `NotoNaskhArabic-latin-${w}.woff2`, weight: w, style: 'normal' },
  { family: 'BB Vazirmatn', file: `Vazirmatn-arabic-${w}.woff2`, weight: w, style: 'normal' },
  { family: 'BB Vazirmatn Latin', file: `Vazirmatn-latin-${w}.woff2`, weight: w, style: 'normal' },
  { family: 'BB Serif', file: `NotoSerif-latin-${w}-normal.woff2`, weight: w, style: 'normal' },
  { family: 'BB Serif', file: `NotoSerif-latin-${w}-italic.woff2`, weight: w, style: 'italic' },
] as FontFile[]);

export const fontBytes = (f: FontFile) => readFileSync(join(FONTS_DIR, f.file));

/** @font-face rules. `src` is a data: URL (PDF) or a relative path (EPUB). */
export function fontFaceCss(srcFor: (f: FontFile) => string): string {
  return FONT_FILES.map((f) =>
    `@font-face{font-family:'${f.family}';src:url('${srcFor(f)}') format('woff2');font-weight:${f.weight};font-style:${f.style};font-display:block}`,
  ).join('\n');
}

export const fontDataUrl = (f: FontFile) => `data:font/woff2;base64,${fontBytes(f).toString('base64')}`;

export function fontStack(body: 'naskh' | 'vazirmatn', rtl: boolean): { body: string; alt: string } {
  const naskh = `'BB Naskh', 'BB Naskh Latin', 'BB Serif', serif`;
  const vazir = `'BB Vazirmatn', 'BB Vazirmatn Latin', sans-serif`;
  if (!rtl) return { body: `'BB Serif', serif`, alt: vazir };
  return body === 'naskh' ? { body: naskh, alt: vazir } : { body: vazir, alt: naskh };
}
