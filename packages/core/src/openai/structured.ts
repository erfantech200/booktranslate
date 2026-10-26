import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { env, type ReasoningEffort } from '../config';
import { costUsd, ZERO_USAGE, type Usage } from '../cost';

// The ONLY place that talks to OpenAI. Every call uses Structured Outputs (strict JSON schema),
// is validated with zod, gets one corrective retry on invalid output, and is usage-logged.

export type InputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'low' | 'high' | 'auto' | 'original' };

export interface InputMessage {
  role: 'user' | 'developer' | 'assistant';
  content: string | InputContent[];
}

export interface TransportRequest {
  model: string;
  effort: ReasoningEffort;
  instructions: string;
  input: InputMessage[];
  schemaName: string;
  schema: z.ZodType;
  maxOutputTokens?: number;
  cacheKey?: string;
  safetyIdentifier?: string;
}

export interface TransportResponse {
  /** Parsed JSON (not yet zod-validated by us), or null if the model returned no JSON. */
  json: unknown;
  refusal: string | null;
  usage: Usage;
  requestId: string | null;
  incomplete: string | null;
}

/** Swappable for tests (see test/fakeModel.ts). */
export interface ModelTransport {
  create(req: TransportRequest): Promise<TransportResponse>;
}

export class OpenAITransport implements ModelTransport {
  private client: OpenAI;
  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    // The SDK retries 429/5xx/connection errors with exponential backoff and honours Retry-After.
    this.client = new OpenAI({ apiKey, maxRetries: Number(process.env.OPENAI_MAX_RETRIES ?? 5), timeout: 600_000 });
  }

  async create(req: TransportRequest): Promise<TransportResponse> {
    const res = await this.client.responses.create({
      model: req.model,
      instructions: req.instructions,
      input: req.input as any,
      reasoning: { effort: req.effort },
      text: { format: zodTextFormat(req.schema as any, req.schemaName) },
      max_output_tokens: req.maxOutputTokens,
      prompt_cache_key: req.cacheKey,
      prompt_cache_retention: env().PROMPT_CACHE_RETENTION,
      safety_identifier: req.safetyIdentifier,
      store: false,
    });
    let json: unknown = null;
    let refusal: string | null = null;
    for (const item of res.output ?? []) {
      if (item.type !== 'message') continue;
      for (const c of item.content) {
        if (c.type === 'refusal') refusal = c.refusal;
        if (c.type === 'output_text' && json === null) {
          try {
            json = JSON.parse(c.text);
          } catch {
            json = null;
          }
        }
      }
    }
    const u = res.usage;
    return {
      json,
      refusal,
      requestId: (res as any)._request_id ?? res.id ?? null,
      incomplete: res.status === 'incomplete' ? (res.incomplete_details?.reason ?? 'incomplete') : null,
      usage: u
        ? {
            inputTokens: u.input_tokens,
            cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: (u.input_tokens_details as any)?.cache_write_tokens ?? 0,
            outputTokens: u.output_tokens,
            reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
          }
        : ZERO_USAGE,
    };
  }
}

export interface CallContext {
  userId: string;
  /** What the call is for, e.g. 'meal_plan', 'coach_chat', 'checkin_narrative'. Logged in ai_usage. */
  feature: string;
  /** Essential calls (e.g. parsing a meal the user is logging) still run when the monthly budget is used up. */
  essential?: boolean;
  jobId?: string | null;
}

export interface UsageRecord extends CallContext, Usage {
  model: string;
  costUsd: number;
  ok: boolean;
  requestId: string | null;
}

export interface CallHooks {
  /** Throws BudgetExceededError when a cap is hit. Called before every model request. */
  checkBudget(ctx: CallContext): Promise<void>;
  logUsage(rec: UsageRecord): Promise<void>;
}

export class InvalidModelOutputError extends Error {
  constructor(message: string, readonly issues: string) {
    super(message);
    this.name = 'InvalidModelOutputError';
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface StructuredCallArgs<S extends z.ZodType> {
  transport: ModelTransport;
  hooks: CallHooks;
  ctx: CallContext;
  model: string;
  effort: ReasoningEffort;
  schema: S;
  schemaName: string;
  instructions: string;
  input: InputMessage[];
  maxOutputTokens?: number;
  cacheKey?: string;
  /** Extra semantic validation after zod (e.g. "every food id exists"). Return an error string or null. */
  check?: (value: z.infer<S>) => string | null;
}

/**
 * Structured call with one corrective retry. Returns the validated value. Throws
 * InvalidModelOutputError after the second invalid output. The caller decides how to flag it.
 */
export async function structuredCall<S extends z.ZodType>(a: StructuredCallArgs<S>): Promise<{
  value: z.infer<S>;
  usage: Usage;
  attempts: number;
}> {
  let input = a.input;
  let total: Usage = { ...ZERO_USAGE };
  let lastIssue = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    await a.hooks.checkBudget(a.ctx);
    const res = await a.transport.create({
      model: a.model,
      effort: a.effort,
      instructions: a.instructions,
      input,
      schemaName: a.schemaName,
      schema: a.schema,
      maxOutputTokens: a.maxOutputTokens,
      cacheKey: a.cacheKey,
      safetyIdentifier: a.ctx.userId,
    });
    total = addUsage(total, res.usage);

    let issue: string | null = null;
    let value: z.infer<S> | undefined;
    if (res.refusal) issue = `model refused: ${res.refusal}`;
    else if (res.incomplete) issue = `incomplete output (${res.incomplete})`;
    else if (res.json === null) issue = 'output was not valid JSON';
    else {
      const parsed = a.schema.safeParse(res.json);
      if (!parsed.success) issue = parsed.error.issues.slice(0, 8)
        .map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      else {
        value = parsed.data;
        issue = a.check?.(parsed.data) ?? null;
      }
    }

    await a.hooks.logUsage({
      ...a.ctx, ...res.usage, model: a.model,
      costUsd: costUsd(a.model, res.usage), ok: issue === null, requestId: res.requestId,
    });

    if (issue === null && value !== undefined) return { value, usage: total, attempts: attempt };
    lastIssue = issue ?? 'unknown';
    // Corrective retry: show the model what was wrong. The prefix stays identical, so caching still hits.
    input = [
      ...a.input,
      {
        role: 'developer',
        content: `Your previous answer was rejected: ${lastIssue}. Return a complete, valid answer that follows the schema and every instruction.`,
      },
    ];
  }
  throw new InvalidModelOutputError(`Invalid ${a.schemaName} output after retry`, lastIssue);
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}
