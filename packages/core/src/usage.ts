import { env } from './config';
import { maybeOne, query } from './db/pool';
import { BudgetExceededError, type CallContext, type CallHooks, type UsageRecord } from './openai/structured';

const int = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** Month-to-date AI spend for a user (USD, from ai_usage). */
export async function monthToDateSpend(userId: string): Promise<number> {
  const r = await maybeOne<{ spent: string }>(
    `select coalesce(sum(cost_usd), 0) as spent from public.ai_usage
     where user_id = $1 and created_at >= date_trunc('month', now())`,
    [userId],
  );
  return Number(r?.spent ?? 0);
}

/** DB-backed hooks: monthly budget cap (OPENAI_MONTHLY_BUDGET_USD) + ai_usage inserts. */
export const dbCallHooks: CallHooks = {
  async checkBudget(ctx: CallContext) {
    if (ctx.essential) return;
    const cap = env().OPENAI_MONTHLY_BUDGET_USD;
    const spent = await monthToDateSpend(ctx.userId);
    if (spent >= cap) {
      throw new BudgetExceededError(`Monthly AI budget reached ($${spent.toFixed(2)} of $${cap.toFixed(2)})`);
    }
  },

  async logUsage(r: UsageRecord) {
    await query(
      `insert into public.ai_usage
         (user_id, feature, model, job_id, input_tokens, cached_tokens, cache_write_tokens, output_tokens,
          reasoning_tokens, cost_usd, ok, request_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [r.userId, r.feature, r.model, r.jobId ?? null, int(r.inputTokens), int(r.cachedTokens),
       int(r.cacheWriteTokens), int(r.outputTokens), int(r.reasoningTokens), r.costUsd, r.ok, r.requestId],
    );
  },
};
