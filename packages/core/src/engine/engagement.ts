import { COACH } from '../coach.config';
import { toDay } from './weight';

// Engagement (spec §13): the coach tip of the day and weekly badges. Deterministic: the tip is
// chosen by what is true today (not at random), and badges are earned from logged data only.

export type TipTopic = 'pain' | 'preWorkout' | 'postWorkout' | 'protein' | 'sleep' | 'weighIn' | 'restDay' | 'general';

/**
 * The most useful tip for today, in priority order: safety first, then today's training, then
 * yesterday's gaps, then habits. `variant` rotates through a topic's tips by date so the same
 * situation doesn't repeat the same sentence every day.
 */
export function tipOfDay(o: {
  today: string;
  painInLast3Days: boolean;
  trainingToday: boolean | null;
  trainedToday: boolean;
  proteinYesterdayPct: number | null;
  sleepLastNight: number | null;
  weighedInToday: boolean;
  variants: Partial<Record<TipTopic, number>>;
}): { topic: TipTopic; variant: number } {
  const topic: TipTopic =
    o.painInLast3Days ? 'pain'
      : o.trainedToday ? 'postWorkout'
        : o.trainingToday ? 'preWorkout'
          : o.proteinYesterdayPct != null && o.proteinYesterdayPct < COACH.progress.proteinHitPct ? 'protein'
            : o.sleepLastNight != null && o.sleepLastNight < COACH.training.readiness.lowSleepHours ? 'sleep'
              : !o.weighedInToday ? 'weighIn'
                : o.trainingToday === false ? 'restDay'
                  : 'general';
  const n = Math.max(1, o.variants[topic] ?? 1);
  return { topic, variant: toDay(o.today) % n };
}

export type Badge =
  | { kind: 'perfect_week'; workouts: number }
  | { kind: 'protein_streak'; days: number }
  | { kind: 'new_lift'; slugs: string[] }
  | { kind: 'weigh_week' };

/**
 * Badges for the week [from, to] (spec §13): every planned workout done, a protein streak, a lift
 * done for the first time, a weigh-in every day.
 */
export function weeklyBadges(o: {
  from: string;
  to: string;
  workoutDates: readonly string[];
  plannedPerWeek: number;
  proteinStreakDays: number;
  firstTimes: ReadonlyMap<string, string>;
  weighInDates: readonly string[];
}): Badge[] {
  const inWeek = (d: string) => d >= o.from && d <= o.to;
  const out: Badge[] = [];
  const workouts = new Set(o.workoutDates.filter(inWeek)).size;
  if (o.plannedPerWeek > 0 && workouts >= o.plannedPerWeek) out.push({ kind: 'perfect_week', workouts });
  if (o.proteinStreakDays >= COACH.engagement.proteinStreakBadgeDays) out.push({ kind: 'protein_streak', days: o.proteinStreakDays });
  const fresh = [...o.firstTimes].filter(([, d]) => inWeek(d)).map(([slug]) => slug);
  if (fresh.length) out.push({ kind: 'new_lift', slugs: fresh });
  if (new Set(o.weighInDates.filter(inWeek)).size >= 7) out.push({ kind: 'weigh_week' });
  return out;
}
