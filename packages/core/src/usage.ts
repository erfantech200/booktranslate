import { maybeOne, query } from './db/pool.js';
import { BudgetExceededError, type CallContext, type CallHooks, type UsageRecord } from './openai/structured.js';

const int = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** DB-backed hooks: per-book and monthly budget caps + usage_log inserts. */
export const dbCallHooks: CallHooks = {
  async checkBudget(ctx: CallContext) {
    if (ctx.bookId) {
      const b = await maybeOne<{ budget_usd: string | null; spent: string }>(
        `select b.budget_usd,
                coalesce((select sum(cost_usd) from public.usage_log u where u.book_id = b.id), 0) as spent
         from public.books b where b.id = $1`,
        [ctx.bookId],
      );
      if (b?.budget_usd != null && Number(b.spent) >= Number(b.budget_usd)) {
        throw new BudgetExceededError(
          `Book budget reached ($${Number(b.spent).toFixed(2)} of $${Number(b.budget_usd).toFixed(2)})`);
      }
    }
    const m = await maybeOne<{ monthly_budget_usd: string | null; spent: string }>(
      `select s.monthly_budget_usd,
              coalesce((select sum(cost_usd) from public.usage_log u
                        where u.user_id = s.user_id and u.created_at >= date_trunc('month', now())), 0) as spent
       from public.user_settings s where s.user_id = $1`,
      [ctx.userId],
    );
    if (m?.monthly_budget_usd != null && Number(m.spent) >= Number(m.monthly_budget_usd)) {
      throw new BudgetExceededError(
        `Monthly budget reached ($${Number(m.spent).toFixed(2)} of $${Number(m.monthly_budget_usd).toFixed(2)})`);
    }
  },

  async logUsage(r: UsageRecord) {
    await query(
      `insert into public.usage_log
         (user_id, book_id, batch_id, page_id, job_id, stage, model, mode, input_tokens, cached_tokens,
          cache_write_tokens, output_tokens, reasoning_tokens, cost_usd, ok, request_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [r.userId, r.bookId ?? null, r.batchId ?? null, r.pageId ?? null, r.jobId ?? null, r.stage, r.model,
       r.mode, int(r.inputTokens), int(r.cachedTokens), int(r.cacheWriteTokens), int(r.outputTokens), int(r.reasoningTokens),
       r.costUsd, r.ok, r.requestId],
    );
  },
};
