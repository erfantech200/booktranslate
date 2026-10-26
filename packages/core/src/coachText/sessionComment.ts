import { z } from 'zod';
import { textModel } from '../config';
import { dbCallHooks } from '../usage';
import { OpenAITransport, structuredCall, type CallHooks, type ModelTransport } from '../openai/structured';

// Finish-screen comment (spec §8): one or two Persian sentences about a finished session. The
// numbers come from the engine's summary; the model only puts them into words.

export const SessionCommentSchema = z.object({
  comment: z.string().min(10).max(320),
});

export interface SessionCommentInput {
  dayName: string;
  week: number;
  deload: boolean;
  technique: boolean;
  minutes: number;
  workingSets: number;
  plannedSets: number;
  volumeKg: number;
  prs: { exercise: string; kinds: string[]; weight: number; reps: number }[];
  skipped: string[];
  painReported: boolean;
  exercises: { name: string; sets: { weight: number; reps: number; rir: number | null }[]; target: string }[];
}

export const SESSION_COMMENT_INSTRUCTIONS = `You are the strength coach inside a private Persian training app.
Write ONE or TWO short sentences in natural, warm Persian about the session described in the JSON.

Rules:
- Use only facts from the JSON. Never invent numbers, never estimate muscle or fat gained.
- Mention at most one specific thing (a PR, consistency, effort, or what to focus on next time).
- If it was a deload or technique week, praise control and form, not load.
- If pain was reported, say only that the exercise was paused for safety; give no diagnosis or treatment.
- Never mention drugs, hormones, or supplements. No emojis. No exclamation marks in a row.
- Write numbers with Latin digits.
Return JSON: {"comment": "..."}.`;

export async function sessionComment(
  userId: string,
  input: SessionCommentInput,
  deps: { transport?: ModelTransport; hooks?: CallHooks } = {},
): Promise<string> {
  const { model, effort } = textModel();
  const { value } = await structuredCall({
    transport: deps.transport ?? new OpenAITransport(),
    hooks: deps.hooks ?? dbCallHooks,
    ctx: { userId, feature: 'session_comment' },
    model,
    effort,
    schema: SessionCommentSchema,
    schemaName: 'session_comment',
    instructions: SESSION_COMMENT_INSTRUCTIONS,
    input: [{ role: 'user', content: JSON.stringify(input) }],
    maxOutputTokens: 2000,
    cacheKey: 'session_comment_v1',
    check: (v) => (/[؀-ۿ]/.test(v.comment) ? null : 'the comment must be in Persian'),
  });
  return value.comment.trim();
}
