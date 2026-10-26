import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DayKind, SessionPlan } from '@coach/core/shared';
import { GymMode } from '@/components/gym/GymMode';
import type { GymExercise } from '@/components/gym/types';
import { loadLibrary } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { gymInfo } from '@/lib/training';

export const dynamic = 'force-dynamic';

/** Gym mode: the running session full screen, without the tab bar. */
export default async function GymPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const { data: session } = await sb.from('workout_sessions').select('id, plan, note, started_at').eq('status', 'active').maybeSingle();
  if (!session?.plan) redirect('/workout');
  const plan = session.plan as SessionPlan & { rev?: number };
  const [library, { data: sets }, t] = await Promise.all([
    loadLibrary(),
    sb.from('set_logs').select('id, slug, ex_idx, set_idx, is_warmup, weight_kg, reps, rir, rep_min, rep_max, target_rir, logged_at').eq('session_id', session.id),
    getTranslations('workout'),
  ]);
  const slugs = new Set(plan.exercises.map((x) => x.slug));
  const exercises: Record<string, GymExercise> = Object.fromEntries(library.filter((e) => slugs.has(e.slug)).map((e) => [e.slug, gymInfo(e)]));
  return (
    <GymMode
      sessionId={session.id}
      startedAt={session.started_at ?? new Date().toISOString()}
      plan={plan}
      note={session.note ?? ''}
      exercises={exercises}
      dayName={plan.kinds.map((k: DayKind) => t(`days.${k}`)).join(' + ')}
      digits={profile.digits}
      serverSets={(sets ?? []).map((r) => ({
        id: r.id, slug: r.slug, exIdx: r.ex_idx, setIdx: r.set_idx, isWarmup: r.is_warmup, weight: Number(r.weight_kg), reps: r.reps,
        rir: r.rir == null ? null : Number(r.rir), repMin: r.rep_min, repMax: r.rep_max, targetRir: r.target_rir == null ? null : Number(r.target_rir), loggedAt: r.logged_at,
      }))}
    />
  );
}
