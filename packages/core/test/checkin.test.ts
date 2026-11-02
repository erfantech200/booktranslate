import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { calorieDecision, checkinWeekEnd, trainingNotes, waistTrend, weightWeek } from '../src/engine/checkin';
import { tipOfDay, weeklyBadges } from '../src/engine/engagement';
import { addDays, type WeighIn } from '../src/engine/weight';

// Weigh-ins every day from `from` for `days` days, gaining `perWeek` kg a week from `start` kg.
const series = (from: string, days: number, start: number, perWeek: number, skip: (i: number) => boolean = () => false): WeighIn[] =>
  Array.from({ length: days }, (_, i) => i).filter((i) => !skip(i)).map((i) => ({ date: addDays(from, i), weightKg: start + (perWeek / 7) * i }));

describe('weekly check-in: weight trend', () => {
  const end = '2026-11-06'; // a Friday

  it('the check-in reviews the week ending on the chosen weekday', () => {
    expect(checkinWeekEnd('2026-11-06', 6)).toBe('2026-11-06');
    expect(checkinWeekEnd('2026-11-08', 6)).toBe('2026-11-06'); // Sunday after → last Friday
    expect(checkinWeekEnd('2026-11-05', 6)).toBe('2026-10-30');
  });

  it('needs at least 4 weigh-ins in the week, otherwise says so', () => {
    const few = series(addDays(end, -6), 7, 70, 0.3, (i) => i % 2 === 1); // 4 of 7: enough
    expect(weightWeek(few, end, 0.45).status).toBe('ok');
    const three = series(addDays(end, -6), 7, 70, 0.3, (i) => i > 2); // 3 of 7
    const w = weightWeek(three, end, 0.45);
    expect(w.status).toBe('not_enough');
    expect(w.thisAvg).toBeNull();
  });

  it('two-week rate and the target in kg/week from the % rate', () => {
    const w = weightWeek(series(addDays(end, -20), 21, 70, 0.35), end, 0.45);
    expect(w.rate2w).toBeCloseTo(0.35, 2);
    expect(w.weekChange).toBeCloseTo(0.35, 2);
    expect(w.targetRate).toBeCloseTo((w.thisAvg! * 0.45) / 100, 2);
  });
});

describe('weekly check-in: calorie rule (spec §11)', () => {
  const end = '2026-11-06';
  const base = { waistPerMonth: null, strengthPct: 1, currentSurplus: 300, lastChange: null, today: end };
  const wk = (perWeek: number) => weightWeek(series(addDays(end, -20), 21, 70, perWeek), end, 0.45); // target ≈ 0.32 kg/wk

  it('more than 0.1 kg/week under target → +150 kcal', () => {
    const d = calorieDecision({ ...base, weight: wk(0.1) });
    expect(d).toMatchObject({ delta: COACH.checkin.raiseKcal, reason: 'below_target', newSurplus: 450 });
  });

  it('within the band → no change', () => {
    expect(calorieDecision({ ...base, weight: wk(0.3) })).toMatchObject({ delta: 0, reason: 'on_track' });
    expect(calorieDecision({ ...base, weight: wk(0.45) })).toMatchObject({ delta: 0, reason: 'on_track' }); // +0.13 over
  });

  it('more than 0.15 kg/week over → −100, and −150 when far over', () => {
    expect(calorieDecision({ ...base, weight: wk(0.5) })).toMatchObject({ delta: -100, reason: 'above_target' });
    expect(calorieDecision({ ...base, weight: wk(0.8) })).toMatchObject({ delta: -150, reason: 'above_target' });
  });

  it('waist rising > 1 cm/month with flat strength → −100 even when the rate looks fine', () => {
    expect(calorieDecision({ ...base, weight: wk(0.3), waistPerMonth: 1.6, strengthPct: 0 })).toMatchObject({ delta: -100, reason: 'waist_rising' });
    // Strength still rising: the waist alone doesn't trigger it.
    expect(calorieDecision({ ...base, weight: wk(0.3), waistPerMonth: 1.6, strengthPct: 4 })).toMatchObject({ delta: 0, reason: 'on_track' });
  });

  it('at most one change a week, never without data, and the surplus stays in bounds', () => {
    expect(calorieDecision({ ...base, weight: wk(0.1), lastChange: addDays(end, -3) })).toMatchObject({ delta: 0, reason: 'recent_change' });
    expect(calorieDecision({ ...base, weight: wk(0.1), lastChange: addDays(end, -7) }).delta).toBe(150);
    const empty = weightWeek([], end, 0.45);
    expect(calorieDecision({ ...base, weight: empty })).toMatchObject({ delta: 0, reason: 'not_enough_weighins' });
    const oneWeek = weightWeek(series(addDays(end, -6), 7, 70, 0.1), end, 0.45);
    expect(calorieDecision({ ...base, weight: oneWeek })).toMatchObject({ delta: 0, reason: 'need_two_weeks' });
    expect(calorieDecision({ ...base, weight: wk(0.1), currentSurplus: COACH.checkin.surplusMaxKcal - 50 }))
      .toMatchObject({ delta: 50, newSurplus: COACH.checkin.surplusMaxKcal });
    expect(calorieDecision({ ...base, weight: wk(0.1), currentSurplus: COACH.checkin.surplusMaxKcal })).toMatchObject({ delta: 0, reason: 'at_limit' });
  });

  it('waist trend needs measurements at least 3 weeks apart', () => {
    expect(waistTrend([{ date: '2026-10-20', waist: 82 }, { date: '2026-11-03', waist: 83 }], '2026-11-06')).toBeNull(); // 14 days
    expect(waistTrend([{ date: '2026-10-06', waist: 82 }, { date: '2026-11-05', waist: 83.5 }], '2026-11-06')).toBeCloseTo(1.5, 1);
  });
});

describe('weekly check-in: training notes', () => {
  it('orders deload first, then swaps, recovery only without a deload, pain, missed sessions', () => {
    const notes = trainingNotes({
      stalled: [{ slug: 'goblet-squat', to: 'leg-press' }], earlyDeload: 'readiness', lowReadinessDays: 5,
      recurringPainAreas: ['knee'], workoutsDone: 2, workoutsPlanned: 4,
    });
    expect(notes.map((n) => n.kind)).toEqual(['early_deload', 'swap', 'pain', 'missed']);
    expect(trainingNotes({ stalled: [], earlyDeload: null, lowReadinessDays: 3, recurringPainAreas: [], workoutsDone: 4, workoutsPlanned: 4 })
      .map((n) => n.kind)).toEqual(['recovery']);
  });
});

describe('engagement', () => {
  const base = { today: '2026-11-03', painInLast3Days: false, trainingToday: true, trainedToday: false, proteinYesterdayPct: 95,
    sleepLastNight: 7.5, weighedInToday: true, variants: { preWorkout: 3, general: 4 } };

  it('tip of the day follows today, safety first', () => {
    expect(tipOfDay({ ...base, painInLast3Days: true }).topic).toBe('pain');
    expect(tipOfDay(base).topic).toBe('preWorkout');
    expect(tipOfDay({ ...base, trainedToday: true }).topic).toBe('postWorkout');
    expect(tipOfDay({ ...base, trainingToday: false, proteinYesterdayPct: 60 }).topic).toBe('protein');
    expect(tipOfDay({ ...base, trainingToday: false, weighedInToday: false }).topic).toBe('weighIn');
    expect(tipOfDay({ ...base, trainingToday: false }).topic).toBe('restDay');
    expect(tipOfDay({ ...base, trainingToday: null }).topic).toBe('general');
    const v = tipOfDay(base).variant;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(3);
    expect(tipOfDay({ ...base, today: '2026-11-04' }).variant).not.toBe(v); // rotates by day
  });

  it('weekly badges are earned from logged data only', () => {
    const b = weeklyBadges({
      from: '2026-10-24', to: '2026-10-30',
      workoutDates: ['2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30'], plannedPerWeek: 4,
      proteinStreakDays: 9, firstTimes: new Map([['hip-thrust', '2026-10-28'], ['goblet-squat', '2026-09-01']]),
      weighInDates: Array.from({ length: 7 }, (_, i) => addDays('2026-10-24', i)),
    });
    expect(b.map((x) => x.kind)).toEqual(['perfect_week', 'protein_streak', 'new_lift', 'weigh_week']);
    expect(b.find((x) => x.kind === 'new_lift')).toEqual({ kind: 'new_lift', slugs: ['hip-thrust'] });
    expect(weeklyBadges({ from: '2026-10-24', to: '2026-10-30', workoutDates: ['2026-10-24'], plannedPerWeek: 4,
      proteinStreakDays: 2, firstTimes: new Map(), weighInDates: [] })).toEqual([]);
  });
});
