// Copies pdf.js's worker next to the app so the in-browser PDF preview loads it from our own
// origin (CSP: worker-src 'self'). Runs before dev/build, so it always matches the installed
// pdfjs-dist version. The copy is git-ignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(import.meta.dirname, '..', 'public', 'pdfjs');
mkdirSync(out, { recursive: true });
copyFileSync(join(pkgDir, 'legacy', 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'));
