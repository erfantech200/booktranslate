import 'server-only';
import { addDays, COACH, isTrainingDate, streak, tipOfDay, weekOfDate, weeklyBadges, type Badge, type TipTopic } from '@coach/core/shared';
import type { Profile } from './profile';
import { loadFoodDays, loadTargetsByDate } from './progress';
import type { supabaseServer } from './supabase/server';
import { loadActiveMeso, loadReadiness } from './training';
import type { WeighInRow } from './weights';

// Today screen engagement (spec §13): the coach tip of the day (chosen by what is true today),
// last week's badges and the logging streaks. Everything is computed from logged data.

type SB = Awaited<ReturnType<typeof supabaseServer>>;

export async function loadEngagement(sb: SB, profile: Profile, today: string, weighIns: WeighInRow[], tipVariants: Partial<Record<TipTopic, number>>) {
  const since = addDays(today, -60);
  const thisWeek = weekOfDate(today);
  const from = addDays(thisWeek, -7), to = addDays(thisWeek, -1);
  const [food, targetFor, readiness, block, { data: pain }, { data: sessionsNear }, { data: creatine }, { data: lastWeek }] = await Promise.all([
    loadFoodDays(sb, since), loadTargetsByDate(sb), loadReadiness(sb, addDays(today, -1)), loadActiveMeso(sb),
    sb.from('pain_reports').select('date').gte('date', addDays(today, -3)).limit(1),
    sb.from('workout_sessions').select('date, status').gte('date', addDays(today, -7)),
    sb.from('supplement_logs').select('date').eq('kind', 'creatine').gte('date', since),
    sb.from('workout_sessions').select('id, date').eq('status', 'done').gte('date', from).lte('date', to),
  ]);
  // Lifts done last week for the first time ever (only last week's sessions are read, not the whole year).
  const weekIds = (lastWeek ?? []).map((x) => x.id as string);
  const firstTimes = new Map<string, string>();
  if (weekIds.length) {
    const { data: weekSets } = await sb.from('set_logs').select('slug, session_id, logged_at').in('session_id', weekIds).eq('is_warmup', false);
    const slugs = [...new Set((weekSets ?? []).map((x) => x.slug as string))];
    const earliest = (weekSets ?? []).map((x) => x.logged_at as string).sort()[0];
    if (slugs.length && earliest) {
      const { data: before } = await sb.from('set_logs').select('slug').in('slug', slugs).lt('logged_at', earliest).eq('is_warmup', false).limit(1000);
      const seen = new Set((before ?? []).map((x) => x.slug as string));
      const dateOf = new Map((lastWeek ?? []).map((x) => [x.id as string, x.date as string]));
      for (const r of weekSets ?? []) if (!seen.has(r.slug) && !firstTimes.has(r.slug)) firstTimes.set(r.slug, dateOf.get(r.session_id) ?? from);
    }
  }
  const hit = (d: { date: string; protein: number }) => {
    const t = targetFor(d.date);
    return !!t && d.protein >= (t.protein * COACH.progress.proteinHitPct) / 100;
  };
  const yesterday = addDays(today, -1);
  const fy = food.find((f) => f.date === yesterday);
  const ty = targetFor(yesterday);
  const sessions = (sessionsNear ?? []) as { date: string; status: 'active' | 'done' | 'skipped' }[];
  const trainingToday = block ? isTrainingDate({ date: today, today, trainingWeekdays: block.meso.trainingDays, sessions }) : null;
  const tip = tipOfDay({
    today,
    painInLast3Days: (pain ?? []).length > 0,
    trainingToday,
    trainedToday: sessions.some((s) => s.date === today && s.status === 'done'),
    proteinYesterdayPct: fy && ty && fy.kcal > 0 ? (fy.protein / ty.protein) * 100 : null,
    sleepLastNight: readiness.find((r) => r.date === today)?.sleepHours ?? null,
    weighedInToday: weighIns.some((w) => w.date === today),
    variants: tipVariants,
  });

  // Badges for the last full calendar week (Saturday to Friday).
  const proteinDates = food.filter((f) => f.date <= to && hit(f)).map((f) => f.date);
  const badges: Badge[] = profile.start_date && profile.start_date <= from ? weeklyBadges({
    from, to,
    workoutDates: (lastWeek ?? []).map((x) => x.date as string),
    plannedPerWeek: block?.meso.daysPerWeek ?? profile.days_per_week ?? 0,
    proteinStreakDays: streak(proteinDates, addDays(to, 1)),
    firstTimes,
    weighInDates: weighIns.map((w) => w.date),
  }) : [];

  return {
    tip,
    badges,
    streaks: {
      weigh: streak(weighIns.map((w) => w.date), today),
      food: streak(food.filter((f) => f.kcal > 0).map((f) => f.date), today),
      creatine: streak((creatine ?? []).map((c) => c.date as string), today),
    },
    readinessLogged: readiness.some((r) => r.date === today),
    trainingToday,
  };
}
