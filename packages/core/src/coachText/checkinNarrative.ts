import { z } from 'zod';
import { textModel } from '../config';
import { dbCallHooks } from '../usage';
import { OpenAITransport, structuredCall, type CallHooks, type ModelTransport } from '../openai/structured';

// Weekly check-in narrative (spec §11.4): what went well, what to improve, 1–3 focus points for
// next week. The model gets the engine's report (numbers already decided) and only words it.

const line = z.string().min(8).max(240);
export const CheckinNarrativeSchema = z.object({
  went_well: z.array(line).min(1).max(3),
  improve: z.array(line).min(0).max(3),
  focus: z.array(line).min(1).max(3),
});
export type CheckinNarrative = z.infer<typeof CheckinNarrativeSchema>;

export const CHECKIN_NARRATIVE_INSTRUCTIONS = `You are the strength and nutrition coach inside a private Persian app for one person who is gaining weight to build muscle.
The JSON is this week's check-in, computed by the app. Write the report card text in natural, warm, direct Persian.

Return JSON:
- "went_well": 1–3 short points about what went well this week.
- "improve": 0–3 short points about what to improve (empty if nothing needs it).
- "focus": 1–3 concrete, doable focus points for next week.

Rules:
- Use only facts from the JSON. Never invent numbers. Never estimate muscle or fat in kilograms.
- The calorie change and the training suggestions were decided by the app; explain them, never change them or add others.
  If "calories.delta" is 0, don't suggest eating more or less.
- If weigh-ins were too few, say a fair comparison needs at least 4 weigh-ins a week.
- Pain: only say to rest that area, use the alternative exercise, and see a physiotherapist if it keeps coming back. No diagnosis or treatment.
- No drugs, hormones, or supplements other than creatine and protein powder. No extreme diets or fasting.
- Each point is one sentence. Write numbers with Latin digits. No emojis.`;

export async function checkinNarrative(
  userId: string,
  report: unknown,
  deps: { transport?: ModelTransport; hooks?: CallHooks } = {},
): Promise<CheckinNarrative> {
  const { model, effort } = textModel();
  const { value } = await structuredCall({
    transport: deps.transport ?? new OpenAITransport(),
    hooks: deps.hooks ?? dbCallHooks,
    ctx: { userId, feature: 'checkin_narrative' },
    model,
    effort,
    schema: CheckinNarrativeSchema,
    schemaName: 'checkin_narrative',
    instructions: CHECKIN_NARRATIVE_INSTRUCTIONS,
    input: [{ role: 'user', content: JSON.stringify(report) }],
    maxOutputTokens: 3000,
    cacheKey: 'checkin_narrative_v1',
    check: (v) => ([...v.went_well, ...v.improve, ...v.focus].every((s) => /[؀-ۿ]/.test(s)) ? null : 'every point must be in Persian'),
  });
  return value;
}
