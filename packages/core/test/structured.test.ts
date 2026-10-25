import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BudgetExceededError, InvalidModelOutputError, structuredCall, type ModelTransport, type TransportResponse, type UsageRecord } from '../src/openai/structured';
import { costUsd, estimateRun } from '../src/cost';

const Schema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
const u = { inputTokens: 1000, cachedTokens: 400, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 50 };

function scripted(responses: Partial<TransportResponse>[]): ModelTransport & { inputs: any[] } {
  const inputs: any[] = [];
  return {
    inputs,
    async create(req) {
      inputs.push(req.input);
      const r = responses.shift()!;
      return { json: null, refusal: null, incomplete: null, requestId: 'r', usage: u, ...r };
    },
  };
}

function hooks() {
  const logged: UsageRecord[] = [];
  return { logged, hooks: { checkBudget: async () => {}, logUsage: async (r: UsageRecord) => { logged.push(r); } } };
}

const base = { ctx: { userId: 'u' }, stage: 'translate' as const, model: 'gpt-6.1-sol', effort: 'medium' as const,
  schema: Schema, schemaName: 't', instructions: 'x', input: [{ role: 'user' as const, content: 'hi' }] };

describe('structuredCall', () => {
  it('returns validated output and logs usage with cost', async () => {
    const h = hooks();
    const r = await structuredCall({ ...base, transport: scripted([{ json: { items: [{ id: 'a', text: 'b' }] } }]), hooks: h.hooks });
    expect(r.value.items[0]!.id).toBe('a');
    expect(r.attempts).toBe(1);
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]!.costUsd).toBeCloseTo(costUsd('gpt-6.1-sol', u), 10);
    expect(h.logged[0]!.ok).toBe(true);
  });

  it('retries once with the validation error, then succeeds', async () => {
    const h = hooks();
    const t = scripted([{ json: { items: [{ id: 1 }] } }, { json: { items: [] } }]);
    const r = await structuredCall({ ...base, transport: t, hooks: h.hooks });
    expect(r.attempts).toBe(2);
    expect(t.inputs[1].at(-1).content).toMatch(/rejected/);
    expect(h.logged.map((l) => l.ok)).toEqual([false, true]);
  });

  it('applies semantic checks and flags after the second invalid output', async () => {
    const h = hooks();
    const t = scripted([{ json: { items: [] } }, { json: { items: [] } }]);
    await expect(structuredCall({ ...base, transport: t, hooks: h.hooks, check: (v) => (v.items.length ? null : 'missing ids') }))
      .rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(h.logged).toHaveLength(2);
  });

  it('treats refusals and truncated output as invalid', async () => {
    const h = hooks();
    await expect(structuredCall({ ...base, transport: scripted([{ refusal: 'no' }, { incomplete: 'max_output_tokens' }]), hooks: h.hooks }))
      .rejects.toThrow(/after retry/);
  });

  it('checks the budget before every request', async () => {
    const t = scripted([{ json: { items: [] } }]);
    await expect(structuredCall({ ...base, transport: t, hooks: { checkBudget: async () => { throw new BudgetExceededError('cap'); }, logUsage: async () => {} } }))
      .rejects.toBeInstanceOf(BudgetExceededError);
    expect(t.inputs).toHaveLength(0);
  });
});

describe('cost', () => {
  it('bills cached input at the cached rate and batch at the discount', () => {
    const full = costUsd('gpt-6-luna', { ...u, cachedTokens: 0 });
    const cached = costUsd('gpt-6-luna', u);
    expect(cached).toBeLessThan(full);
    expect(costUsd('gpt-6-luna', u, 'batch')).toBeCloseTo(cached / 2, 12);
    expect(costUsd('unknown-model', u)).toBe(0);
  });
  it('estimates a 20-page run with Cheap cheaper than Fast', () => {
    const e = estimateRun({ ocrModel: 'gpt-6-luna', translateModel: 'gpt-6.1-sol', ocrPages: 20, sourceTokens: 20 * 450 });
    expect(e.totalFastUsd).toBeGreaterThan(0);
    expect(e.totalCheapUsd).toBeLessThan(e.totalFastUsd);
    expect(e.ocr.usd).toBeLessThan(e.translate.fastUsd);
  });
});
