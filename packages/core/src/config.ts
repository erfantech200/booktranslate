import { z } from 'zod';
import pricesJson from '../config/prices.json' with { type: 'json' };
import pageSizesJson from '../config/page-sizes.json' with { type: 'json' };

// All model IDs, reasoning efforts and concurrency come from the environment. Defaults mirror
// .env.example so a missing var never silently switches to an unexpected model.

const Effort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof Effort>;

const Env = z.object({
  OCR_MODEL: z.string().default('gpt-6-luna'),
  OCR_REASONING_EFFORT: Effort.default('low'),
  OCR_IMAGE_DETAIL: z.enum(['low', 'high', 'auto', 'original']).default('high'),
  STRUCTURE_MODEL: z.string().default('gpt-6-luna'),
  STRUCTURE_REASONING_EFFORT: Effort.default('low'),
  GLOSSARY_MODEL: z.string().default('gpt-6.1-sol'),
  GLOSSARY_REASONING_EFFORT: Effort.default('medium'),
  TRANSLATION_MODEL: z.string().default('gpt-6.1-sol'),
  TRANSLATION_REASONING_EFFORT: Effort.default('medium'),
  PREMIUM_TRANSLATION_MODEL: z.string().default('gpt-6-astra'),
  PREMIUM_TRANSLATION_REASONING_EFFORT: Effort.default('medium'),
  // Models offered in "compare models on this page" (Phase 2).
  COMPARE_MODELS: z.string().default('gpt-6.1-sol,gpt-6-astra,gpt-6-luna'),

  TRANSLATION_CHUNK_MIN_TOKENS: z.coerce.number().int().positive().default(1500),
  TRANSLATION_CHUNK_MAX_TOKENS: z.coerce.number().int().positive().default(2500),
  TRANSLATION_CONTEXT_BLOCKS: z.coerce.number().int().min(0).max(6).default(3),
  OCR_CONCURRENCY: z.coerce.number().int().positive().default(4),
  TRANSLATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  OCR_MAX_IMAGE_PX: z.coerce.number().int().positive().default(2048),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1500),
  JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(600).default(600),
  PROMPT_CACHE_RETENTION: z.enum(['in_memory', '24h']).default('24h'),
});
export type CoreEnv = z.infer<typeof Env>;

let cached: CoreEnv | null = null;
export function env(): CoreEnv {
  if (!cached) cached = Env.parse(process.env);
  return cached;
}
/** Tests only. */
export function resetEnvCache() {
  cached = null;
}

export type Stage = 'ocr' | 'structure' | 'glossary' | 'translate' | 'retranslate' | 'compare';

export interface StageModel {
  model: string;
  effort: ReasoningEffort;
}

export function stageModel(stage: Stage, quality: 'standard' | 'premium' = 'standard'): StageModel {
  const e = env();
  switch (stage) {
    case 'ocr':
      return { model: e.OCR_MODEL, effort: e.OCR_REASONING_EFFORT };
    case 'structure':
      return { model: e.STRUCTURE_MODEL, effort: e.STRUCTURE_REASONING_EFFORT };
    case 'glossary':
      return { model: e.GLOSSARY_MODEL, effort: e.GLOSSARY_REASONING_EFFORT };
    case 'translate':
    case 'retranslate':
    case 'compare':
      return quality === 'premium'
        ? { model: e.PREMIUM_TRANSLATION_MODEL, effort: e.PREMIUM_TRANSLATION_REASONING_EFFORT }
        : { model: e.TRANSLATION_MODEL, effort: e.TRANSLATION_REASONING_EFFORT };
  }
}

// ─── Prices ─────────────────────────────────────────────────────────────────────────────────
const ModelPrice = z.object({
  input: z.number().nonnegative(),
  cachedInput: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().default(0),
  output: z.number().nonnegative(),
});
const Prices = z.object({
  batchDiscount: z.number().min(0).max(1),
  models: z.record(z.string(), ModelPrice),
});
export type ModelPrice = z.infer<typeof ModelPrice>;
export const prices = Prices.parse(pricesJson);

// ─── Page sizes ─────────────────────────────────────────────────────────────────────────────
const PageSize = z.object({
  label: z.string(),
  labelFa: z.string(),
  widthMm: z.number(),
  heightMm: z.number(),
  margins: z.object({ top: z.number(), bottom: z.number(), inner: z.number(), outer: z.number() }),
});
export type PageSizeKey = 'A4' | 'A5' | 'roqee' | 'vaziri' | 'letter';
export type PageSize = z.infer<typeof PageSize>;
export const pageSizes = z.record(z.string(), PageSize).parse(pageSizesJson) as Record<PageSizeKey, PageSize>;
