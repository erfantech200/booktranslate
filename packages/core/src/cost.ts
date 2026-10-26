import { prices, type ModelPrice } from './config';

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
export function costUsd(model: string, u: Usage): number {
  const p = priceFor(model);
  if (!p) return 0;
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens - u.cacheWriteTokens);
  return (
    uncached * p.input +
    u.cachedTokens * p.cachedInput +
    u.cacheWriteTokens * (p.cacheWrite || p.input) +
    u.outputTokens * p.output
  ) / 1_000_000;
}
