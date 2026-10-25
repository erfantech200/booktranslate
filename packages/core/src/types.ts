import { z } from 'zod';

// ─── Model output schemas (Structured Outputs) ──────────────────────────────────────────────
// Structured Outputs in strict mode require every property to be present, so optional values
// are expressed as `nullable` rather than optional. Numeric ranges are described, not
// constrained (min/max keywords are not reliably supported in strict schemas); code clamps.

export const BLOCK_TYPES = [
  'heading', 'paragraph', 'quote', 'list_item', 'footnote', 'caption', 'table', 'poem',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const ExtractedBlock = z.object({
  id: z.string().describe('Short id unique within this page, e.g. "b1", "b2" in reading order.'),
  type: z.enum(BLOCK_TYPES),
  level: z.number().int().nullable()
    .describe('Heading level (1 = chapter title). null for non-headings.'),
  text: z.string().describe(
    'Block text with inline markdown for *italic* and **bold**. Footnote markers in body text as [^n]. ' +
    'Poems keep line breaks as \\n. Tables as GitHub markdown.'),
  footnote_marker: z.string().nullable()
    .describe('For type=footnote: the marker it belongs to (e.g. "1", "*"). Otherwise null.'),
  starts_mid_sentence: z.boolean()
    .describe('True if the block continues a sentence from the previous page.'),
  ends_mid_sentence: z.boolean()
    .describe('True if the block is cut off mid-sentence at the bottom of the page.'),
});
export type ExtractedBlock = z.infer<typeof ExtractedBlock>;

export const PageQuality = z.object({
  legibility: z.number().describe('0 = unreadable … 1 = perfectly legible'),
  cut_off: z.boolean().describe('Text is cut off at an edge of the photo.'),
  blur: z.boolean(),
  glare: z.boolean(),
});
export type PageQuality = z.infer<typeof PageQuality>;

export const PageExtraction = z.object({
  printed_page_number: z.number().int().nullable()
    .describe('The page number printed on the page (arabic numerals). null if none or roman.'),
  is_spread: z.boolean().describe('True if the photo shows two book pages side by side.'),
  blocks: z.array(ExtractedBlock),
  quality: PageQuality,
});
export type PageExtraction = z.infer<typeof PageExtraction>;

export const TranslationOutput = z.object({
  translations: z.array(z.object({
    id: z.string().describe('The block id exactly as given in the input.'),
    text: z.string().describe('The translation of that block, same inline markdown conventions.'),
  })),
  translator_notes: z.array(z.object({
    block_id: z.string(),
    note: z.string().describe('A short translator\'s note for a cultural reference.'),
  })).describe('Only when the book setting enables translator notes; otherwise an empty array.'),
});
export type TranslationOutput = z.infer<typeof TranslationOutput>;

export const BookBrief = z.object({
  genre: z.string(),
  era: z.string(),
  narrator_pov: z.string(),
  tone: z.string(),
  audience: z.string(),
  summary_for_translator: z.string()
    .describe('2–4 sentences of context a translator needs. No spoilers beyond the given text.'),
});
export type BookBrief = z.infer<typeof BookBrief>;

export const GLOSSARY_KINDS = ['character', 'place', 'organization', 'term', 'other'] as const;
export const GlossaryOutput = z.object({
  brief: BookBrief,
  terms: z.array(z.object({
    source_term: z.string(),
    target_term: z.string(),
    kind: z.enum(GLOSSARY_KINDS),
    notes: z.string().nullable().describe('Gender, relationship, register (تو/شما) or usage notes.'),
  })),
});
export type GlossaryOutput = z.infer<typeof GlossaryOutput>;

// ─── Book settings (books.settings jsonb) ───────────────────────────────────────────────────
export const BookSettings = z.object({
  dialogueRegister: z.enum(['formal', 'spoken']).default('formal'),
  persianDigits: z.boolean().default(true),
  showLatinNames: z.boolean().default(false),
  translatorNotes: z.boolean().default(false),
  quality: z.enum(['standard', 'premium']).default('standard'),
  mode: z.enum(['fast', 'cheap']).default('fast'),
  bodyFont: z.enum(['naskh', 'vazirmatn']).default('naskh'),
  fontSizePt: z.number().min(8).max(18).default(11.5),
  pageSize: z.enum(['A4', 'A5', 'roqee', 'vaziri', 'letter']).default('A5'),
  footnotes: z.enum(['chapter_end', 'page_bottom']).default('chapter_end'),
});
export type BookSettings = z.infer<typeof BookSettings>;
export const parseBookSettings = (raw: unknown): BookSettings =>
  BookSettings.parse(raw && typeof raw === 'object' ? raw : {});

// ─── Export options ─────────────────────────────────────────────────────────────────────────
export const ExportScope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('book') }),
  z.object({ type: z.literal('batch'), batchId: z.string().uuid() }),
  z.object({ type: z.literal('chapter'), chapterIndex: z.number().int().min(0) }),
  z.object({ type: z.literal('pages'), from: z.number().int(), to: z.number().int() }),
]);
export type ExportScope = z.infer<typeof ExportScope>;

export const ExportOptions = z.object({
  pageSize: z.enum(['A4', 'A5', 'roqee', 'vaziri', 'letter']).optional(),
  bodyFont: z.enum(['naskh', 'vazirmatn']).optional(),
  fontSizePt: z.number().min(8).max(18).optional(),
  grayscale: z.boolean().optional(),
});
export type ExportOptions = z.infer<typeof ExportOptions>;

// ─── Job payloads ──────────────────────────────────────────────────────────────────────────
export const JOB_TYPES = [
  'ingest_batch', 'extract_page', 'assemble_batch', 'glossary_batch', 'translate_batch',
  'render_export', 'retranslate_block', 'cleanup_sources',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JobPayloads = {
  ingest_batch: z.object({ batchId: z.string().uuid() }),
  extract_page: z.object({ pageId: z.string().uuid() }),
  assemble_batch: z.object({ batchId: z.string().uuid() }),
  glossary_batch: z.object({ batchId: z.string().uuid() }),
  translate_batch: z.object({ batchId: z.string().uuid() }),
  render_export: z.object({ exportId: z.string().uuid() }),
  retranslate_block: z.object({ blockId: z.string().uuid(), instruction: z.string().max(1000).optional() }),
  cleanup_sources: z.object({ batchId: z.string().uuid() }),
} satisfies Record<JobType, z.ZodTypeAny>;

// ─── Lint ──────────────────────────────────────────────────────────────────────────────────
export type LintFlagCode =
  | 'untranslated_latin'
  | 'length_ratio'
  | 'missing_block'
  | 'glossary_violation'
  | 'empty_translation'
  | 'invalid_output';
export interface LintFlag {
  code: LintFlagCode;
  message: string;
  detail?: string;
}

export interface Warning {
  code: 'missing_pages' | 'duplicate_page' | 'low_quality' | 'blur' | 'glare' | 'cut_off'
    | 'overlaps_previous_batch' | 'no_text' | 'needs_review';
  pageId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export const RTL_LANGS = new Set(['fa', 'ar', 'he', 'ur', 'ps', 'ckb', 'yi']);
export const isRtl = (lang: string) => RTL_LANGS.has(lang.split('-')[0]!.toLowerCase());

export const LANGUAGE_NAMES: Record<string, string> = {
  fa: 'Persian (Farsi)', en: 'English', ar: 'Arabic', de: 'German', fr: 'French', es: 'Spanish',
  tr: 'Turkish', ru: 'Russian', it: 'Italian', he: 'Hebrew', ur: 'Urdu', zh: 'Chinese', ja: 'Japanese',
};
export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code;
