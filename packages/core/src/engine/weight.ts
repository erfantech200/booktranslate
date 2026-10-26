import { COACH } from '../coach.config';
import type { EXPERIENCE } from './profile';

// Deterministic bodyweight math: gain-rate defaults, the 12-month plan line, the 7-day moving
// average and the trend projection. Dates are ISO 'YYYY-MM-DD' strings (calendar days, no TZ).

export type Experience = (typeof EXPERIENCE)[number];
export interface WeighIn { date: string; weightKg: number }
export interface TrendPoint { date: string; kg: number }

const DAY = 86_400_000;
export const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromDay(toDay(iso) + n);

export const isNovice = (e: Experience) => e === 'none' || e === 'lt6m';

/** Engine default weekly gain (% bodyweight) for the current training age. */
export function defaultGainRate(e: Experience, weeksTrained = 0): number {
  const novice = isNovice(e) && weeksTrained < COACH.gainRate.noviceWeeks;
  return novice ? COACH.gainRate.novice.default : COACH.gainRate.intermediate.default;
}

export const clampGainRate = (pct: number) => Math.min(COACH.gainRate.hardMax, Math.max(COACH.gainRate.hardMin, pct));

/**
 * Planned bodyweight `week` weeks after the start. A manual rate applies all year; the engine
 * default switches from the novice to the intermediate rate after `noviceWeeks`.
 */
export function plannedWeight(startKg: number, e: Experience, week: number, manualPct?: number | null): number {
  let w = startKg;
  for (let k = 0; k < week; k++) {
    const pct = manualPct != null ? clampGainRate(manualPct) : defaultGainRate(e, k);
    w *= 1 + pct / 100;
  }
  return w;
}

/** Default 12-month target when the owner doesn't set one (rounded to 0.5 kg). */
export const defaultTarget12m = (startKg: number, e: Experience, manualPct?: number | null) =>
  Math.round(plannedWeight(startKg, e, COACH.goal.horizonWeeks, manualPct) * 2) / 2;

/** Weekly points of the plan line from the start date. */
export function planLine(startDate: string, startKg: number, e: Experience, manualPct?: number | null): TrendPoint[] {
  return Array.from({ length: COACH.goal.horizonWeeks + 1 }, (_, k) => ({
    date: addDays(startDate, k * 7),
    kg: plannedWeight(startKg, e, k, manualPct),
  }));
}

/** Trailing moving average over calendar days (default 7), one point per weigh-in date. */
export function movingAverage(points: WeighIn[], days: number = COACH.weight.movingAverageDays): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => {
    const from = toDay(p.date) - (days - 1);
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && toDay(sorted[j]!.date) >= from; j--) {
      sum += sorted[j]!.weightKg;
      n++;
    }
    return { date: p.date, kg: sum / n };
  });
}

export interface Projection {
  /** Current trend, kg per week (from a least-squares fit of the moving average). */
  kgPerWeek: number;
  /** Where the trend lands at the end of the 12 months (from the start date). */
  atHorizonKg: number;
  horizonDate: string;
}

/**
 * Linear projection of the recent moving average to the end of the plan. Null until there are
 * `projectionMinDays` of data in the window: a trend from a few days is just noise.
 */
export function projectTrend(points: WeighIn[], startDate: string): Projection | null {
  const ma = movingAverage(points);
  if (ma.length < 2) return null;
  const last = toDay(ma[ma.length - 1]!.date);
  const window = ma.filter((p) => toDay(p.date) > last - COACH.weight.projectionWindowDays);
  const span = toDay(window[window.length - 1]!.date) - toDay(window[0]!.date);
  if (window.length < 2 || span < COACH.weight.projectionMinDays) return null;
  const xs = window.map((p) => toDay(p.date));
  const ys = window.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i]! - my); den += (x - mx) ** 2; });
  const slopePerDay = den === 0 ? 0 : num / den;
  const horizonDate = addDays(startDate, COACH.goal.horizonWeeks * 7);
  return {
    kgPerWeek: slopePerDay * 7,
    atHorizonKg: my + slopePerDay * (toDay(horizonDate) - mx),
    horizonDate,
  };
}
