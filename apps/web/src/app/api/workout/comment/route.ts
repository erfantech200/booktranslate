import { NextResponse, type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { BudgetExceededError, sessionComment, type SessionCommentInput } from '@coach/core';
import type { SessionPlan, SessionSummary } from '@coach/core/shared';
import { loadLibrary } from '@/lib/library';
import { supabaseServer } from '@/lib/supabase/server';

// Finish-screen coach comment (spec §8), generated once per session after the summary is saved.
// The model gets the engine's numbers and only words them; usage is logged to ai_usage through
// the core pool (service role), like every AI call.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: s } = await sb.from('workout_sessions').select('id, week, deload, plan, summary, coach_comment, comment_status').eq('id', sessionId ?? '').maybeSingle();
  if (!s) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (s.comment_status !== 'pending') return NextResponse.json({ status: s.comment_status, comment: s.coach_comment });

  const plan = s.plan as SessionPlan;
  const summary = s.summary as SessionSummary;
  const t = await getTranslations('workout');
  const names = new Map((await loadLibrary()).map((e) => [e.slug, e.nameFa]));
  const { data: sets } = await sb.from('set_logs').select('slug, weight_kg, reps, rir').eq('session_id', s.id).eq('is_warmup', false).order('logged_at');
  const { count: pain } = await sb.from('pain_reports').select('id', { count: 'exact', head: true }).eq('session_id', s.id);
  const input: SessionCommentInput = {
    dayName: plan.kinds.map((k) => t(`days.${k}`)).join(' + '),
    week: s.week,
    deload: s.deload,
    technique: plan.technique,
    minutes: summary.minutes,
    workingSets: summary.workingSets,
    plannedSets: plan.exercises.filter((x) => !x.skipped).reduce((n, x) => n + x.sets, 0),
    volumeKg: summary.volumeKg,
    prs: summary.prs.map((p) => ({ exercise: names.get(p.slug) ?? p.slug, kinds: p.kinds, weight: p.weight, reps: p.reps })),
    skipped: plan.exercises.filter((x) => x.skipped).map((x) => names.get(x.slug) ?? x.slug),
    painReported: (pain ?? 0) > 0,
    exercises: plan.exercises.filter((x) => !x.skipped).map((x) => ({
      name: names.get(x.slug) ?? x.slug,
      target: `${x.sets}×${x.reps[0]}–${x.reps[1]} RIR ${x.rir}`,
      sets: (sets ?? []).filter((r) => r.slug === x.slug).map((r) => ({ weight: Number(r.weight_kg), reps: r.reps, rir: r.rir == null ? null : Number(r.rir) })),
    })),
  };
  try {
    const comment = await sessionComment(user.id, input);
    await sb.from('workout_sessions').update({ coach_comment: comment, comment_status: 'ok' }).eq('id', s.id);
    return NextResponse.json({ status: 'ok', comment });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'session comment failed', err: err instanceof Error ? err.message : String(err) }));
    await sb.from('workout_sessions').update({ comment_status: 'failed' }).eq('id', s.id);
    return NextResponse.json({ status: 'failed', budget: err instanceof BudgetExceededError });
  }
}
