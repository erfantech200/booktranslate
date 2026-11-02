import { COACH } from '../coach.config';
import { weekday } from './schedule';
import { addDays, toDay, type WeighIn } from './weight';

// Weekly check-in (spec §11). Pure: the caller loads the data, this decides. Numbers that matter
// (the calorie change, which lifts stalled, whether to deload) come from here; the LLM only words
// the report afterwards.

const C = COACH.checkin;
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The last day of the week the check-in on `date` reviews: the most recent check-in weekday. */
export function checkinWeekEnd(date: string, checkinWeekday: number): string {
  const back = (weekday(date) - checkinWeekday + 7) % 7;
  return addDays(date, -back);
}

export interface WeightWeek {
  status: 'ok' | 'not_enough';
  weighIns: number;
  thisAvg: number | null;
  lastAvg: number | null;
  /** This week's average minus last week's (kg). */
  weekChange: number | null;
  /** Average weekly gain over two weeks (kg/week), the number the calorie rule uses. */
  rate2w: number | null;
  /** Target gain (kg/week) from the plan's rate. */
  targetRate: number;
}

function avgIn(ws: readonly WeighIn[], from: string, to: string) {
  const xs = ws.filter((w) => w.date >= from && w.date <= to).map((w) => w.weightKg);
  return { n: xs.length, avg: xs.length >= COACH.weight.minWeighInsPerWeek ? mean(xs) : null };
}

/** 7-day averages for the reviewed week and the two before it (each needs ≥ 4 weigh-ins). */
export function weightWeek(ws: readonly WeighIn[], weekEnd: string, targetPctPerWeek: number): WeightWeek {
  const w0 = avgIn(ws, addDays(weekEnd, -6), weekEnd);
  const w1 = avgIn(ws, addDays(weekEnd, -13), addDays(weekEnd, -7));
  const w2 = avgIn(ws, addDays(weekEnd, -20), addDays(weekEnd, -14));
  const ref = w0.avg ?? w1.avg ?? ws.at(-1)?.weightKg ?? 0;
  return {
    status: w0.avg == null ? 'not_enough' : 'ok',
    weighIns: w0.n,
    thisAvg: w0.avg == null ? null : round2(w0.avg),
    lastAvg: w1.avg == null ? null : round2(w1.avg),
    weekChange: w0.avg != null && w1.avg != null ? round2(w0.avg - w1.avg) : null,
    rate2w: w0.avg != null && w2.avg != null ? round2((w0.avg - w2.avg) / 2) : null,
    targetRate: round2((ref * targetPctPerWeek) / 100),
  };
}

/** Waist change per 30 days from the measurements of the last few weeks, or null with too little data. */
export function waistTrend(ms: readonly { date: string; waist: number | null }[], weekEnd: string): number | null {
  const xs = ms.filter((m) => m.waist != null && m.date <= weekEnd && m.date >= addDays(weekEnd, -C.waistWindowDays))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (xs.length < 2) return null;
  const span = toDay(xs.at(-1)!.date) - toDay(xs[0]!.date);
  if (span < C.waistMinSpanDays) return null;
  return round2(((xs.at(-1)!.waist! - xs[0]!.waist!) / span) * 30);
}

export type CalorieReason =
  | 'below_target' | 'above_target' | 'waist_rising' | 'on_track'
  | 'not_enough_weighins' | 'need_two_weeks' | 'recent_change' | 'at_limit';

export interface CalorieDecision {
  delta: number;
  reason: CalorieReason;
  currentSurplus: number;
  newSurplus: number;
}

/** The calorie rule (spec §11): at most one change a week, within the surplus bounds. */
export function calorieDecision(o: {
  weight: WeightWeek;
  waistPerMonth: number | null;
  /** Mean change of the main lifts' best e1RM over the last 4 weeks (%), null without data. */
  strengthPct: number | null;
  currentSurplus: number;
  /** Date the last weekly or manual calorie change took effect, if any. */
  lastChange: string | null;
  today: string;
}): CalorieDecision {
  const keep = (reason: CalorieReason): CalorieDecision => ({ delta: 0, reason, currentSurplus: o.currentSurplus, newSurplus: o.currentSurplus });
  const w = o.weight;
  if (w.thisAvg == null) return keep('not_enough_weighins');
  if (o.lastChange && toDay(o.today) - toDay(o.lastChange) < C.minDaysBetweenChanges) return keep('recent_change');

  let delta = 0;
  let reason: CalorieReason = 'on_track';
  const waistRising = o.waistPerMonth != null && o.waistPerMonth > C.waistRisingCmPerMonth
    && o.strengthPct != null && o.strengthPct <= COACH.progress.strengthFlatPct;
  if (w.rate2w == null && !waistRising) return keep('need_two_weeks');
  if (w.rate2w != null && w.rate2w > w.targetRate + C.aboveTargetKgPerWeek) {
    delta = -(w.rate2w > w.targetRate + C.largeOverKgPerWeek ? C.lowerKcalLarge : C.lowerKcal);
    reason = 'above_target';
  } else if (waistRising) {
    delta = -C.lowerKcal;
    reason = 'waist_rising';
  } else if (w.rate2w != null && w.rate2w < w.targetRate - C.belowTargetKgPerWeek) {
    delta = C.raiseKcal;
    reason = 'below_target';
  }
  if (delta === 0) return keep(reason);
  const next = Math.min(C.surplusMaxKcal, Math.max(C.surplusMinKcal, o.currentSurplus + delta));
  if (next === o.currentSurplus) return keep('at_limit');
  return { delta: next - o.currentSurplus, reason, currentSurplus: o.currentSurplus, newSurplus: next };
}

export type TrainingNote =
  | { kind: 'swap'; slug: string; to: string | null }
  | { kind: 'early_deload'; reason: 'regression' | 'readiness' }
  | { kind: 'recovery'; lowDays: number }
  | { kind: 'pain'; areas: string[] }
  | { kind: 'missed'; done: number; planned: number };

/** Deterministic training suggestions from the week's signals (spec §11.3). */
export function trainingNotes(o: {
  stalled: readonly { slug: string; to: string | null }[];
  earlyDeload: 'regression' | 'readiness' | null;
  lowReadinessDays: number;
  recurringPainAreas: readonly string[];
  workoutsDone: number;
  workoutsPlanned: number;
}): TrainingNote[] {
  const out: TrainingNote[] = [];
  if (o.earlyDeload) out.push({ kind: 'early_deload', reason: o.earlyDeload });
  for (const s of o.stalled) out.push({ kind: 'swap', slug: s.slug, to: s.to });
  if (!o.earlyDeload && o.lowReadinessDays >= C.lowReadinessDays) out.push({ kind: 'recovery', lowDays: o.lowReadinessDays });
  if (o.recurringPainAreas.length) out.push({ kind: 'pain', areas: [...o.recurringPainAreas] });
  if (o.workoutsPlanned > 0 && o.workoutsDone < o.workoutsPlanned) out.push({ kind: 'missed', done: o.workoutsDone, planned: o.workoutsPlanned });
  return out;
}

export interface CheckinReport {
  weekStart: string;
  weekEnd: string;
  weight: WeightWeek;
  waistPerMonth: number | null;
  strengthPct: number | null;
  calories: CalorieDecision;
  training: TrainingNote[];
  adherence: {
    workoutsDone: number;
    workoutsPlanned: number;
    proteinDays: number;
    kcalDays: number;
    loggedDays: number;
  };
  prs: number;
}
