import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Core reads a few files at runtime (prompts, fonts, pdfjs font/cmap data). Run from source
// (tsx, Vitest, the Docker worker) they sit next to this file. Bundled into the Next.js worker
// route on Vercel, `import.meta.url` points into `.next/`, so we fall back to locations relative
// to the working directory (next.config.ts traces those files into the function).
//
// Bundler note: Turbopack's file tracer statically evaluates path expressions and crashes on
// ones that resolve to a directory. So the only statically visible paths here point at files;
// directory candidates are built from a working directory it cannot evaluate.

const runtimeCwd = (): string => Reflect.apply(process.cwd, process, []) as string;

function firstExisting(candidates: (string | null | undefined)[], probe: string): string | null {
  for (const c of candidates) {
    if (c && existsSync(join(c, probe))) return c;
  }
  return null;
}

function resolveFile(from: string, request: string): string | null {
  try {
    return createRequire(from).resolve(request);
  } catch {
    return null;
  }
}

const PROBE = join('prompts', 'ocr.v1.md');

let coreDir: string | null = null;
/** Absolute path of packages/core. */
export function coreRoot(): string {
  if (coreDir) return coreDir;
  const fromSource = resolveFile(import.meta.url, '../prompts/ocr.v1.md'); // <core>/prompts/ocr.v1.md
  const cwd = runtimeCwd();
  coreDir = firstExisting([
    process.env.BOOKBRIDGE_CORE_DIR,
    fromSource ? dirname(dirname(fromSource)) : null,
    join(cwd, 'packages', 'core'),
    join(cwd, '..', '..', 'packages', 'core'),
    join(cwd, 'node_modules', '@bookbridge', 'core'),
  ], PROBE);
  if (!coreDir) throw new Error(`Cannot locate packages/core assets (cwd=${cwd}); set BOOKBRIDGE_CORE_DIR`);
  return coreDir;
}

// The files are traced explicitly (apps/web/next.config.ts → outputFileTracingIncludes), so the
// bundler must not try to trace this dynamic path (it would pull in the whole repository).
export const corePath = (...parts: string[]) => join(/* turbopackIgnore: true */ coreRoot(), ...parts);

let pdfjsDir: string | null = null;
/** Directory of the installed pdfjs-dist package (for standard fonts and CMaps). */
export function pdfjsRoot(): string {
  if (pdfjsDir) return pdfjsDir;
  const cwd = runtimeCwd();
  const pkg = resolveFile(import.meta.url, 'pdfjs-dist/package.json')
    ?? resolveFile(join(cwd, 'package.json'), 'pdfjs-dist/package.json');
  pdfjsDir = firstExisting([
    pkg ? dirname(pkg) : null,
    join(cwd, 'node_modules', 'pdfjs-dist'),
  ], 'standard_fonts');
  if (!pdfjsDir) throw new Error('Cannot locate pdfjs-dist');
  return pdfjsDir;
}
