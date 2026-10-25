import type { LintFlag } from '../types.js';
import { fixPersian, normalizeForMatch } from './fa.js';

export { fixPersian, normalizeForMatch, toPersianDigits, ZWNJ } from './fa.js';

export interface GlossaryEntry {
  source_term: string;
  target_term: string;
  locked: boolean;
}

export interface LintInput {
  targetLang: string;
  sourceText: string;
  translatedText: string;
  glossary: GlossaryEntry[];
  persianDigits: boolean;
  blockType?: string;
}

export interface LintResult {
  text: string;
  fixes: string[];
  flags: LintFlag[];
}

/** Safe auto-fixes for the target language (identity for languages without a linter). */
export function autoFix(targetLang: string, text: string, opts: { persianDigits: boolean }) {
  if (targetLang === 'fa') return fixPersian(text, opts);
  return { text: text.trim(), fixes: [] as string[] };
}

const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

/**
 * Flags (never auto-fixed). For non-Latin targets: untranslated Latin sentences (names and
 * glossary source terms excepted), abnormal length ratio, empty output, locked glossary terms
 * missing from the translation.
 */
export function flagsFor(i: LintInput, fixedText: string): LintFlag[] {
  const flags: LintFlag[] = [];
  const src = i.sourceText.trim();
  const out = fixedText.trim();
  if (!out) {
    flags.push({ code: 'empty_translation', message: 'Translation is empty' });
    return flags;
  }

  const nonLatinTarget = ['fa', 'ar', 'he', 'ur', 'ru', 'zh', 'ja', 'ko', 'el', 'hi'].includes(i.targetLang);
  if (nonLatinTarget) {
    const allowed = new Set<string>();
    for (const g of i.glossary) for (const w of g.source_term.match(LATIN_WORD) ?? []) allowed.add(w.toLowerCase());
    // Remove text in parentheses right after a name (the optional "show Latin names" form) and markers.
    const scan = out.replace(/\([^)]*\)/g, ' ').replace(/\[\^[^\]]+\]/g, ' ');
    const runs = scan.match(/[A-Za-z][A-Za-z'’,;:-]*(?:\s+[A-Za-z][A-Za-z'’,;:.-]*)+/g) ?? [];
    for (const run of runs) {
      const words = run.match(LATIN_WORD) ?? [];
      const unknown = words.filter((w) => !allowed.has(w.toLowerCase()));
      // 4+ consecutive non-glossary Latin words ≈ an untranslated sentence fragment.
      if (unknown.length >= 4) {
        flags.push({ code: 'untranslated_latin', message: 'Untranslated Latin text', detail: run.slice(0, 160) });
        break;
      }
    }
  }

  // Length ratio in characters (ignoring markup). Only meaningful for longer blocks.
  const plain = (s: string) => s.replace(/[*_\[\]^‌]/g, '').replace(/\s+/g, ' ').trim();
  const sl = plain(src).length;
  const tl = plain(out).length;
  if (sl >= 120) {
    const ratio = tl / sl;
    const [lo, hi] = i.targetLang === 'fa' ? [0.55, 1.9] : [0.5, 2.2];
    if (ratio < lo || ratio > hi) {
      flags.push({
        code: 'length_ratio',
        message: ratio < lo ? 'Translation is much shorter than the source' : 'Translation is much longer than the source',
        detail: ratio.toFixed(2),
      });
    }
  }

  // Locked glossary terms: if the source term occurs, its rendering must occur too.
  const outNorm = normalizeForMatch(out);
  for (const g of i.glossary) {
    if (!g.locked) continue;
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(g.source_term)}(?=$|[^\\p{L}])`, 'iu');
    if (!re.test(src)) continue;
    if (!outNorm.includes(normalizeForMatch(g.target_term))) {
      flags.push({
        code: 'glossary_violation',
        message: `Locked term "${g.source_term}" must be rendered as «${g.target_term}»`,
        detail: g.source_term,
      });
    }
  }
  return flags;
}

export function lintBlock(i: LintInput): LintResult {
  const fixed = autoFix(i.targetLang, i.translatedText, { persianDigits: i.persianDigits });
  return { text: fixed.text, fixes: fixed.fixes, flags: flagsFor(i, fixed.text) };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
