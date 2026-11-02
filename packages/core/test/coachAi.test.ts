import { describe, expect, it } from 'vitest';
import { checkinNarrative } from '../src/coachText/checkinNarrative';
import { coachChat, CoachReplySchema } from '../src/coachText/coachChat';
import { EXERCISES } from '../src/data/exercises';
import { mentionsRedFlag } from '../src/engine/safety';
import { exerciseImagePrompt } from '../src/images';
import type { ModelTransport, TransportResponse, UsageRecord } from '../src/openai/structured';

const usage = { inputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 0 };
function scripted(responses: unknown[]): ModelTransport & { reqs: any[] } {
  const reqs: any[] = [];
  return {
    reqs,
    async create(req) {
      reqs.push(req);
      return { json: responses.shift() ?? null, refusal: null, incomplete: null, requestId: 'r', usage } as TransportResponse;
    },
  };
}
const hooks = () => {
  const logged: UsageRecord[] = [];
  return { logged, hooks: { checkBudget: async () => {}, logUsage: async (r: UsageRecord) => { logged.push(r); } } };
};

describe('coach chat (spec §12)', () => {
  it('sends the app data as a developer message, the history, then the question; logs feature coach_chat', async () => {
    const t = scripted([{ reply: 'سلام، برای گرم کردن ۵ دقیقه پیاده‌روی کنید.', proposals: [] }]);
    const h = hooks();
    const r = await coachChat('u1', { context: { today: '2026-11-02' }, history: [{ role: 'user', content: 'قبلی' }, { role: 'assistant', content: 'جواب قبلی' }], message: 'چطور گرم کنم؟' },
      { transport: t, hooks: h.hooks });
    expect(r.reply).toContain('گرم');
    const input = t.reqs[0].input;
    expect(input[0].role).toBe('developer');
    expect(input[0].content).toContain('2026-11-02');
    expect(input.map((m: any) => m.role)).toEqual(['developer', 'user', 'assistant', 'user']);
    expect(h.logged[0]!.feature).toBe('coach_chat');
  });

  it('proposals are typed; an id outside the context is sent back for one corrective retry', async () => {
    const bad = { reply: 'پیشنهاد می‌کنم حرکت را عوض کنیم.', proposals: [{ type: 'swap_exercise', from: 'made-up', to: 'leg-press', reason: 'درد زانو' }] };
    const good = { reply: 'پیشنهاد می‌کنم حرکت را عوض کنیم.', proposals: [{ type: 'swap_exercise', from: 'goblet-squat', to: 'leg-press', reason: 'درد زانو' }] };
    const t = scripted([bad, good]);
    const r = await coachChat('u1', {
      context: {}, history: [], message: 'زانوم با اسکوات درد می‌گیره',
      checkProposals: (ps) => (ps.some((p) => p.type === 'swap_exercise' && p.from !== 'goblet-squat') ? 'from is not in the program' : null),
    }, { transport: t, hooks: hooks().hooks });
    expect(t.reqs).toHaveLength(2);
    expect(JSON.stringify(t.reqs[1].input)).toContain('from is not in the program');
    expect(r.proposals[0]).toMatchObject({ type: 'swap_exercise', from: 'goblet-squat', to: 'leg-press' });
  });

  it('the schema rejects unknown proposal types and more than three proposals', () => {
    expect(CoachReplySchema.safeParse({ reply: 'x', proposals: [{ type: 'buy_supplements', reason: 'xxxx' }] }).success).toBe(false);
    const p = { type: 'add_note', text: 'یادداشت', reason: 'یادآوری' };
    expect(CoachReplySchema.safeParse({ reply: 'x', proposals: [p, p, p, p] }).success).toBe(false);
  });

  it('red flags are caught before the model (Persian and English)', () => {
    for (const s of ['موقع تمرین قفسه سینه‌ام درد گرفت', 'سرگیجه دارم', 'دستم بی‌حس شد', 'نزدیک بود غش کنم', 'تنگی نفس دارم', 'I have chest pain'])
      expect(mentionsRedFlag(s), s).toBe(true);
    for (const s of ['زانوم کمی درد می‌کنه', 'قبل از تمرین چی بخورم؟', 'پشت بازو سیم‌کش']) expect(mentionsRedFlag(s), s).toBe(false);
  });
});

describe('check-in narrative (spec §11.4)', () => {
  it('returns the three lists and insists on Persian', async () => {
    const english = { went_well: ['You trained four times'], improve: [], focus: ['Sleep more'] };
    const persian = { went_well: ['چهار جلسه کامل انجام شد.'], improve: [], focus: ['هر شب ۸ ساعت بخوابید.'] };
    const t = scripted([english, persian]);
    const h = hooks();
    const n = await checkinNarrative('u1', { calories: { delta: 0 } }, { transport: t, hooks: h.hooks });
    expect(n.focus[0]).toContain('بخوابید');
    expect(t.reqs).toHaveLength(2);
    expect(h.logged.map((x) => x.feature)).toEqual(['checkin_narrative', 'checkin_narrative']);
  });
});

describe('exercise illustration prompt (spec §7)', () => {
  it('one style: two panels, muscles highlighted, no text', () => {
    const p = exerciseImagePrompt(EXERCISES.find((e) => e.slug === 'goblet-squat')!);
    expect(p).toContain('Goblet');
    expect(p).toMatch(/two panels/i);
    expect(p).toMatch(/no text/i);
    expect(p).toMatch(/start position/);
  });
});
