import { z } from 'zod';
import pricesJson from '../config/prices.json' with { type: 'json' };

// Model IDs, reasoning efforts, the AI budget and worker tuning come from the environment.
// Defaults mirror .env.example so a missing var never silently switches to another model.

const Effort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof Effort>;

const Env = z.object({
  OPENAI_TEXT_MODEL: z.string().default('gpt-6.1-sol'),
  OPENAI_TEXT_REASONING_EFFORT: Effort.default('low'),
  OPENAI_VISION_MODEL: z.string().default('gpt-6-luna'),
  OPENAI_VISION_REASONING_EFFORT: Effort.default('low'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2.5-flare'),
  // Month-to-date cap on logged AI spend; non-essential calls are blocked above it.
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(20),
  PROMPT_CACHE_RETENTION: z.enum(['in_memory', '24h']).default('24h'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(600).default(600),
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

export interface ModelChoice {
  model: string;
  effort: ReasoningEffort;
}

export const textModel = (): ModelChoice => ({ model: env().OPENAI_TEXT_MODEL, effort: env().OPENAI_TEXT_REASONING_EFFORT });
export const visionModel = (): ModelChoice => ({ model: env().OPENAI_VISION_MODEL, effort: env().OPENAI_VISION_REASONING_EFFORT });

// ─── Prices ─────────────────────────────────────────────────────────────────────────────────
const ModelPrice = z.object({
  input: z.number().nonnegative(),
  cachedInput: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().default(0),
  output: z.number().nonnegative(),
});
const Prices = z.object({ models: z.record(z.string(), ModelPrice) });
export type ModelPrice = z.infer<typeof ModelPrice>;
export const prices = Prices.parse(pricesJson);
