import { NextResponse, type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { BudgetExceededError, coachChat, type Proposal } from '@coach/core';
import { COACH, mentionsRedFlag } from '@coach/core/shared';
import { validateProposal } from '@/lib/adjustments';
import { adjustmentOf } from '@/lib/checkin';
import { coachContext, type CoachAllowed } from '@/lib/coachContext';
import { loadProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';

// AI coach chat (spec §12). The owner's message is stored, the model answers with the app's data
// as context, and any proposed change is checked against the engine's bounds before it becomes a
// card. Red flags get the fixed stop message without asking the model.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function checkIds(allowed: CoachAllowed) {
  return (ps: readonly Proposal[]): string | null => {
    for (const p of ps) {
      if (p.type === 'swap_exercise') {
        if (!allowed.programSlugs.has(p.from)) return `swap_exercise.from "${p.from}" is not in the current program`;
        if (!allowed.substitutes.get(p.from)?.has(p.to)) return `swap_exercise.to "${p.to}" is not a listed substitute of ${p.from}`;
      }
      if (p.type === 'regenerate_meal' && !allowed.mealIds.has(p.meal_id)) return `regenerate_meal.meal_id "${p.meal_id}" is not in this week's plan`;
      if (p.type === 'adjust_calories' && Math.abs(p.delta_kcal) > COACH.coach.calorieChangeMaxKcal) return 'adjust_calories.delta_kcal is outside -150..150';
    }
    return null;
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const message = String(body.message ?? '').trim();
  if (!message) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (message.length > COACH.coach.maxMessageChars) return NextResponse.json({ error: 'too_long' }, { status: 400 });
  const { sb, user, profile } = await loadProfile();
  if (!profile?.onboarded_at) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: mine, error: e0 } = await sb.from('coach_messages').insert({ user_id: user.id, role: 'user', content: message }).select('id, role, content, created_at').single();
  if (e0 || !mine) return NextResponse.json({ error: 'failed' }, { status: 500 });

  // Red flags: the fixed safety message (spec §6), never model-written.
  if (mentionsRedFlag(message)) {
    const t = await getTranslations('coach');
    const { data: reply } = await sb.from('coach_messages').insert({ user_id: user.id, role: 'assistant', content: t('redFlag') })
      .select('id, role, content, created_at').single();
    return NextResponse.json({ user: mine, reply, adjustments: [], dropped: 0, redFlag: true });
  }

  const today = await localToday();
  const { data: past } = await sb.from('coach_messages').select('role, content, created_at').lt('created_at', mine.created_at)
    .order('created_at', { ascending: false }).limit(COACH.coach.historyMessages);
  const history = (past ?? []).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

  try {
    const { context, allowed } = await coachContext(sb, user.id, profile, today);
    const out = await coachChat(user.id, { context, history, message, checkProposals: checkIds(allowed) });
    const { data: reply, error: e1 } = await sb.from('coach_messages').insert({ user_id: user.id, role: 'assistant', content: out.reply.trim() })
      .select('id, role, content, created_at').single();
    if (e1 || !reply) throw new Error(e1?.message ?? 'reply insert failed');
    // Re-check every proposal against the engine's bounds; only valid ones become cards.
    const rows = [];
    let dropped = 0;
    for (const p of out.proposals) {
      const v = await validateProposal(sb, profile, p, today);
      if ('error' in v) { dropped++; continue; }
      rows.push({ user_id: user.id, source: 'coach', message_id: reply.id, type: v.type, before: v.before, after: v.after, reason: v.reason });
    }
    const { data: adj } = rows.length ? await sb.from('adjustments').insert(rows).select('*') : { data: [] };
    return NextResponse.json({ user: mine, reply, adjustments: (adj ?? []).map(adjustmentOf), dropped });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'coach chat failed', err: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json({ user: mine, error: err instanceof BudgetExceededError ? 'budget' : 'failed' }, { status: 200 });
  }
}
