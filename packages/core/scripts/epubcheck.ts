// Renders the sample book to EPUB and validates it with W3C epubcheck (downloaded once into
// .tools/). Exit code ≠ 0 on any error or warning. Needs Java 11+.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEpub } from '../src/render/epub.js';
import { sampleBook } from '../test/fixtures/sampleBook.js';

const VERSION = '5.4.0';
const root = join(import.meta.dirname, '..', '..', '..');
const tools = join(root, '.tools');
const jar = join(tools, `epubcheck-${VERSION}`, 'epubcheck.jar');

export function ensureEpubcheck(): string {
  if (existsSync(jar)) return jar;
  mkdirSync(tools, { recursive: true });
  const zip = join(tools, 'epubcheck.zip');
  execFileSync('curl', ['-sSLf', '-o', zip, `https://github.com/w3c/epubcheck/releases/download/v${VERSION}/epubcheck-${VERSION}.zip`], { stdio: 'inherit' });
  execFileSync('unzip', ['-qo', zip, '-d', tools], { stdio: 'inherit' });
  return jar;
}

export function epubcheck(file: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('java', ['-jar', ensureEpubcheck(), '--failonwarnings', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(root, 'fixtures', 'out');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'sample.epub');
  writeFileSync(file, await renderEpub(sampleBook(), { bodyFont: 'naskh', fontSizePt: 11.5 }));
  const r = epubcheck(file);
  console.log(r.output);
  process.exit(r.ok ? 0 : 1);
}
