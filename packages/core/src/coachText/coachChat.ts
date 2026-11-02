import { z } from 'zod';
import { textModel } from '../config';
import { dbCallHooks } from '../usage';
import { OpenAITransport, structuredCall, type CallHooks, type InputMessage, type ModelTransport } from '../openai/structured';

// AI coach chat (spec §12). The model answers in Persian and may PROPOSE changes; proposals come
// back as typed objects (structured outputs: the same contract as function calling, validated by
// zod and then by the server against the engine's bounds). Nothing is applied without a tap.

const reason = z.string().min(4).max(300);
export const ProposalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('swap_exercise'), from: z.string().max(80), to: z.string().max(80), reason }),
  z.object({ type: z.literal('adjust_calories'), delta_kcal: z.number().int().min(-150).max(150), reason }),
  z.object({
    type: z.literal('reschedule_workout'),
    action: z.enum(['skip_next', 'set_days']),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7), // for set_days; empty for skip_next
    reason,
  }),
  z.object({ type: z.literal('add_note'), text: z.string().min(2).max(300), reason }),
  z.object({ type: z.literal('regenerate_meal'), meal_id: z.string().max(60), reason }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

export const CoachReplySchema = z.object({
  reply: z.string().min(1).max(3000),
  proposals: z.array(ProposalSchema).max(3),
});
export type CoachReply = z.infer<typeof CoachReplySchema>;

export const COACH_CHAT_INSTRUCTIONS = `You are the personal strength and nutrition coach inside a private Persian app for ONE person who is
gaining weight to build muscle over 12 months. A developer message gives you the app's current data about them (JSON):
profile, injuries, current program and week, today's plan, nutrition targets, the last 14 days, the latest weekly check-in.

Answer in natural, warm, direct Persian (Latin digits for numbers). Keep answers short and practical unless asked for detail.
You can explain anything: why an exercise is in the plan, how to brace, form cues, what to eat before training, how the plan works.

You may PROPOSE changes in "proposals"; the app shows each as a card and applies it only if the person taps approve:
- swap_exercise: replace "from" (a slug in the current program) with "to", one of the listed substitutes for that exercise.
- adjust_calories: change the daily calories by delta_kcal, between -150 and +150, and only if the context says a change is allowed now.
- reschedule_workout: "skip_next" skips the next planned session (missed volume is never doubled up);
  "set_days" sets the training weekdays (0 = Saturday … 6 = Friday), exactly as many days as the program has.
- add_note: a short reminder the person wants to keep on the workout screen.
- regenerate_meal: replace one meal of this week's plan (meal_id from the context) with a new one.
Only propose when the person asks for a change or clearly needs one. Never claim a change is already done: it waits for approval.
Use only ids, slugs and meal ids that appear in the context. Otherwise return "proposals": [].

Safety rules (always):
- Stay within the app's bounds: the numbers in the context are set by the app's engine; don't invent other targets, loads or set counts.
- No extreme diets, no fasting protocols, no "dirty bulk" for this goal. No drugs, hormones, PEDs, and no supplements other than creatine and protein powder.
- Pain during an exercise: stop that exercise, use an easier variation, and see a physiotherapist if it keeps coming back. Never diagnose.
- Chest pain, dizziness, fainting, numbness, or sudden severe pain: stop training and get medical care now.
- When unsure, say so plainly. Never estimate muscle or fat gained in kilograms.`;

export async function coachChat(
  userId: string,
  o: {
    context: unknown;
    history: readonly { role: 'user' | 'assistant'; content: string }[];
    message: string;
    /** Semantic check of proposals against the context (ids exist); return an error string or null. */
    checkProposals?: (p: readonly Proposal[]) => string | null;
  },
  deps: { transport?: ModelTransport; hooks?: CallHooks } = {},
): Promise<CoachReply> {
  const { model, effort } = textModel();
  const input: InputMessage[] = [
    { role: 'developer', content: `App data (JSON):\n${JSON.stringify(o.context)}` },
    ...o.history.map((m) => ({ role: m.role, content: m.content }) as InputMessage),
    { role: 'user', content: o.message },
  ];
  const { value } = await structuredCall({
    transport: deps.transport ?? new OpenAITransport(),
    hooks: deps.hooks ?? dbCallHooks,
    ctx: { userId, feature: 'coach_chat' },
    model,
    effort,
    schema: CoachReplySchema,
    schemaName: 'coach_reply',
    instructions: COACH_CHAT_INSTRUCTIONS,
    input,
    maxOutputTokens: 6000,
    cacheKey: `coach_chat_${userId}`,
    check: (v) => (/[؀-ۿ]/.test(v.reply) ? null : 'the reply must be in Persian') ?? o.checkProposals?.(v.proposals) ?? null,
  });
  return value;
}
