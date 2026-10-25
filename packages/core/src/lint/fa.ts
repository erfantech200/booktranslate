// Deterministic Persian post-processing. Only SAFE auto-fixes are applied here; anything
// ambiguous becomes a flag (see flags.ts). Inline markdown (*, **), footnote markers [^n] and
// URLs are preserved.

export const ZWNJ = '‌';
const PERSIAN_LETTER = 'ء-غف-يپچژکگیآأؤئ';
const FA = `[${PERSIAN_LETTER}]`;
const FA_OR_DIGIT = `[${PERSIAN_LETTER}۰-۹٠-٩]`;

export interface FaFixOptions {
  /** Convert Western/Arabic-Indic digits in body text to Persian digits. */
  persianDigits: boolean;
}

export interface FixResult {
  text: string;
  fixes: string[];
}

const PROTECT_RE = /\[\^[^\]\s]+\]|https?:\/\/[^\s»)]+|[\w.+-]+@[\w-]+\.[\w.]+/g;

function protect(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const out = text.replace(PROTECT_RE, (m) => {
    saved.push(m);
    return `${String.fromCharCode(0xe100 + saved.length - 1)}`;
  });
  return {
    text: out,
    restore: (s) => s.replace(/([-])/g, (_, c: string) => saved[c.charCodeAt(0) - 0xe100]!),
  };
}

type Rule = { name: string; apply: (s: string) => string };

const characterRules: Rule[] = [
  { name: 'arabic_yeh', apply: (s) => s.replace(/[يى]/g, 'ی') },          // ي ى → ی
  { name: 'arabic_kaf', apply: (s) => s.replace(/ك/g, 'ک') },                  // ك → ک
  { name: 'arabic_heh_yeh', apply: (s) => s.replace(/ۀ/g, 'هٔ') },        // ۀ → هٔ (same glyph, standard form)
];

const zwnjJoinRules: Rule[] = [
  // "می رود" / "نمی رود" → "می‌رود" / "نمی‌رود" (prefix written as a separate word).
  {
    name: 'zwnj_mi_prefix',
    apply: (s) => s.replace(new RegExp(`(^|[\\s«(*])(ن?می) +(?=${FA})`, 'gu'), `$1$2${ZWNJ}`),
  },
  // "کتاب ها" / "کتاب های" / "بزرگ ترین" → half-space. Only suffixes that are never words on
  // their own in running prose ("تر" alone means "wet", so it is left for review).
  {
    name: 'zwnj_suffix',
    apply: (s) => s.replace(
      new RegExp(`(${FA}) +(ها|های|هایی|هایم|هایت|هایش|هایمان|هایتان|هایشان|ترین|تری)(?=$|[\\s.،؛؟!:»)*\\]\\ue000])`, 'gu'),
      `$1${ZWNJ}$2`),
  },
];

const zwnjCleanupRules: Rule[] = [
  // Clean up: duplicate ZWNJ, ZWNJ next to spaces/punctuation, ZWNJ at word edges.
  {
    name: 'zwnj_cleanup',
    apply: (s) => s
      .replace(/‌{2,}/g, ZWNJ)
      .replace(/ ‌|‌ /g, ' ')
      .replace(new RegExp(`\\u200c(?=$|[^${PERSIAN_LETTER}\\u064b-\\u0652])`, 'gu'), '')
      .replace(new RegExp(`(^|[^${PERSIAN_LETTER}\\u064b-\\u0652])\\u200c`, 'gu'), '$1'),
  },
];

const punctuationRules: Rule[] = [
  // Latin comma/semicolon/question mark next to Persian text → Persian forms.
  { name: 'fa_comma', apply: (s) => s.replace(new RegExp(`(${FA_OR_DIGIT}[*»)]*) *,(?!\\d)`, 'gu'), '$1،') },
  { name: 'fa_semicolon', apply: (s) => s.replace(new RegExp(`(${FA_OR_DIGIT}[*»)]*) *;`, 'gu'), '$1؛') },
  { name: 'fa_question', apply: (s) => s.replace(new RegExp(`(${FA_OR_DIGIT}[*»)]*) *\\?`, 'gu'), '$1؟') },
  // Straight or curly double quotes wrapping Persian text → guillemets.
  {
    name: 'fa_quotes',
    apply: (s) => s.replace(new RegExp(`["“”]([^"“”\\n]*${FA}[^"“”\\n]*)["“”]`, 'gu'), '«$1»'),
  },
  // No space before punctuation; no space just inside guillemets.
  { name: 'space_before_punct', apply: (s) => s.replace(/[ \t]+([،؛؟!.:»)\]])/g, '$1') },
  { name: 'space_inside_guillemets', apply: (s) => s.replace(/« +/g, '«').replace(/ +»/g, '»') },
  // One space after Persian punctuation when followed directly by a letter.
  { name: 'space_after_punct', apply: (s) => s.replace(new RegExp(`([،؛؟])(?=${FA}|[A-Za-z«])`, 'gu'), '$1 ') },
];

const whitespaceRules: Rule[] = [
  { name: 'collapse_spaces', apply: (s) => s.replace(/[ \t ]{2,}/g, ' ') },
  { name: 'trim_lines', apply: (s) => s.split('\n').map((l) => l.trim()).join('\n').trim() },
];

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function digitsRule(): Rule {
  return {
    name: 'persian_digits',
    apply: (s) => s
      // Decimal separator between digits: 3.5 → ۳٫۵ (only when no Latin letters are adjacent).
      .replace(/(?<![A-Za-z\d.])(\d+)\.(\d+)(?![A-Za-z\d.])/g, '$1٫$2')
      // Arabic-Indic digits → Persian.
      .replace(/[٠-٩]/g, (d) => PERSIAN_DIGITS[d.charCodeAt(0) - 0x0660]!)
      // Western digits not glued to Latin letters (model numbers like "B52", "MP3" stay).
      .replace(/(?<![A-Za-z\d])\d+(?![A-Za-z\d])/g, (run) => [...run].map((d) => PERSIAN_DIGITS[+d]).join('')),
  };
}

/**
 * Apply all safe Persian fixes. Returns the fixed text and the names of the rules that changed
 * something (for the review UI / tests).
 */
export function fixPersian(input: string, opts: FaFixOptions): FixResult {
  const { text, restore } = protect(input);
  const rules = [
    ...characterRules,
    ...whitespaceRules,
    ...zwnjCleanupRules,
    ...zwnjJoinRules,
    ...zwnjCleanupRules,
    ...punctuationRules,
    ...(opts.persianDigits ? [digitsRule()] : []),
    ...whitespaceRules,
  ];
  let cur = text;
  const fixes: string[] = [];
  for (const r of rules) {
    const next = r.apply(cur);
    if (next !== cur) {
      if (!fixes.includes(r.name)) fixes.push(r.name);
      cur = next;
    }
  }
  return { text: restore(cur), fixes };
}

/** Normalize for comparisons (glossary checks): no ZWNJ/diacritics, Persian ی/ک, lowercase Latin. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ْٰ]/g, '')
    .replace(/‌/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function toPersianDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => PERSIAN_DIGITS[+d]!);
}
