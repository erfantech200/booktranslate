// Copies the OFL fonts used by the renderers from @fontsource packages into assets/fonts.
// The fonts are committed so the worker image and tests don't depend on node_modules layout.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dirname, '..', 'assets', 'fonts');
mkdirSync(out, { recursive: true });
const nm = join(import.meta.dirname, '..', 'node_modules', '@fontsource');
const files: [string, string][] = [];
for (const w of ['400', '700']) {
  files.push([`noto-naskh-arabic/files/noto-naskh-arabic-arabic-${w}-normal.woff2`, `NotoNaskhArabic-arabic-${w}.woff2`]);
  files.push([`noto-naskh-arabic/files/noto-naskh-arabic-latin-${w}-normal.woff2`, `NotoNaskhArabic-latin-${w}.woff2`]);
  files.push([`vazirmatn/files/vazirmatn-arabic-${w}-normal.woff2`, `Vazirmatn-arabic-${w}.woff2`]);
  files.push([`vazirmatn/files/vazirmatn-latin-${w}-normal.woff2`, `Vazirmatn-latin-${w}.woff2`]);
  for (const s of ['normal', 'italic']) files.push([`noto-serif/files/noto-serif-latin-${w}-${s}.woff2`, `NotoSerif-latin-${w}-${s}.woff2`]);
}
files.push(['noto-naskh-arabic/LICENSE', 'OFL-NotoNaskhArabic.txt'], ['vazirmatn/LICENSE', 'OFL-Vazirmatn.txt'], ['noto-serif/LICENSE', 'OFL-NotoSerif.txt']);
for (const [from, to] of files) copyFileSync(join(nm, from), join(out, to));
console.log(`copied ${files.length} files to ${out}`);
