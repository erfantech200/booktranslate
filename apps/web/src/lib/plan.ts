import 'server-only';
import { defaultGainRate, defaultTarget12m, movingAverage, planLine, projectTrend, toDay, type WeighIn } from '@coach/core/shared';
import type { Profile } from './profile';

/** Everything the Today and Progress screens show about bodyweight, from the deterministic engine. */
export function planSummary(profile: Profile, weighIns: WeighIn[], todayIso = new Date().toISOString().slice(0, 10)) {
  const exp = profile.experience ?? 'none';
  const startDate = profile.start_date!;
  const startKg = profile.start_weight_kg!;
  const manual = profile.target_gain_pct_week;
  const weeksIn = Math.max(0, Math.floor((toDay(todayIso) - toDay(startDate)) / 7));
  const ratePct = manual ?? defaultGainRate(exp, weeksIn);
  const trend = movingAverage(weighIns);
  return {
    exp,
    startDate,
    startKg,
    ratePct,
    targetKgPerWeek: ((trend.at(-1)?.kg ?? startKg) * ratePct) / 100,
    target12m: profile.target_weight_12m_kg ?? defaultTarget12m(startKg, exp, manual),
    plan: planLine(startDate, startKg, exp, manual),
    trend,
    current: trend.at(-1)?.kg ?? null,
    projection: projectTrend(weighIns, startDate),
    dayNumber: Math.max(1, toDay(todayIso) - toDay(startDate) + 1),
  };
}
