import { prices, type ModelPrice } from './config.js';

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0,
};

export function priceFor(model: string): ModelPrice | null {
  return prices.models[model] ?? null;
}

/**
 * Cost in USD. `inputTokens` includes cached and cache-write tokens (that is how the API reports
 * it), so those are subtracted before the uncached rate is applied. Reasoning tokens are part of
 * `outputTokens` and billed as output. An unknown model costs 0 and the caller logs it; we
 * never invent a price.
 */
export function costUsd(model: string, u: Usage, mode: 'fast' | 'batch' = 'fast'): number {
  const p = priceFor(model);
  if (!p) return 0;
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens - u.cacheWriteTokens);
  const usd =
    (uncached * p.input +
      u.cachedTokens * p.cachedInput +
      u.cacheWriteTokens * (p.cacheWrite || p.input) +
      u.outputTokens * p.output) /
    1_000_000;
  return mode === 'batch' ? usd * prices.batchDiscount : usd;
}

/**
 * Rough token count without a tokenizer dependency. English ≈ 4 chars/token. Persian and other
 * non-Latin scripts tokenize denser, ≈ 2.5 chars/token. This is used only for chunking and
 * estimates, never for billing; billing uses the API's reported usage.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x0250) latin++;
    else other++;
  }
  return Math.ceil(latin / 4 + other / 2.5);
}

/** Image input token estimate for a page photo at OCR resolution (high detail, ~2048px long side). */
export const OCR_IMAGE_TOKENS_ESTIMATE = 1600;
/** Typical extracted text tokens per printed book page. */
export const TOKENS_PER_PAGE_ESTIMATE = 450;

export interface RunEstimate {
  ocr: { model: string; inputTokens: number; outputTokens: number; usd: number };
  translate: { model: string; inputTokens: number; outputTokens: number; fastUsd: number; cheapUsd: number };
  totalFastUsd: number;
  totalCheapUsd: number;
}

/**
 * Estimate before a run. `ocrPages` = pages needing OCR. `sourceTokens` = source text to
 * translate (estimated from page count if OCR hasn't run yet). Persian output ≈ 1.6× the
 * English token count. The stable prompt prefix is assumed cached after the first chunk.
 */
export function estimateRun(opts: {
  ocrModel: string;
  translateModel: string;
  ocrPages: number;
  sourceTokens: number;
  prefixTokens?: number;
  chunkTokens?: number;
}): RunEstimate {
  const prefix = opts.prefixTokens ?? 2500;
  const chunk = opts.chunkTokens ?? 2000;
  const ocrIn = opts.ocrPages * (OCR_IMAGE_TOKENS_ESTIMATE + 900);
  const ocrOut = opts.ocrPages * Math.round(TOKENS_PER_PAGE_ESTIMATE * 1.3);
  const ocrUsd = costUsd(opts.ocrModel, { ...ZERO_USAGE, inputTokens: ocrIn, outputTokens: ocrOut });

  const chunks = Math.max(1, Math.ceil(opts.sourceTokens / chunk));
  const contextTokens = 600;
  const trIn = chunks * (prefix + contextTokens) + opts.sourceTokens + opts.sourceTokens * 0.3;
  const trCached = Math.max(0, chunks - 1) * prefix;
  const trOut = Math.round(opts.sourceTokens * 1.6 * 1.25); // + reasoning headroom
  const usage: Usage = { ...ZERO_USAGE, inputTokens: Math.round(trIn), cachedTokens: trCached, outputTokens: trOut };
  const fast = costUsd(opts.translateModel, usage, 'fast');
  const cheap = costUsd(opts.translateModel, { ...usage, cachedTokens: 0 }, 'batch');
  return {
    ocr: { model: opts.ocrModel, inputTokens: ocrIn, outputTokens: ocrOut, usd: ocrUsd },
    translate: {
      model: opts.translateModel, inputTokens: Math.round(trIn), outputTokens: trOut,
      fastUsd: fast, cheapUsd: cheap,
    },
    totalFastUsd: ocrUsd + fast,
    totalCheapUsd: ocrUsd * prices.batchDiscount + cheap,
  };
}
