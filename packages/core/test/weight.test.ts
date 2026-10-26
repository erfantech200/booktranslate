import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { addDays, clampGainRate, defaultGainRate, defaultTarget12m, movingAverage, planLine, plannedWeight, projectTrend } from '../src/engine/weight';
import { ProfileInput } from '../src/engine/profile';

describe('gain rate', () => {
  it('uses the novice rate for beginners until noviceWeeks, then the intermediate rate', () => {
    expect(defaultGainRate('none')).toBe(COACH.gainRate.novice.default);
    expect(defaultGainRate('lt6m', COACH.gainRate.noviceWeeks - 1)).toBe(COACH.gainRate.novice.default);
    expect(defaultGainRate('lt6m', COACH.gainRate.noviceWeeks)).toBe(COACH.gainRate.intermediate.default);
    expect(defaultGainRate('gt2y')).toBe(COACH.gainRate.intermediate.default);
  });
  it('clamps manual rates to the hard bounds', () => {
    expect(clampGainRate(2)).toBe(COACH.gainRate.hardMax);
    expect(clampGainRate(0)).toBe(COACH.gainRate.hardMin);
    expect(clampGainRate(0.3)).toBe(0.3);
  });
});

describe('plan', () => {
  it('compounds weekly and switches rate after the novice phase', () => {
    const r1 = 1 + COACH.gainRate.novice.default / 100;
    const r2 = 1 + COACH.gainRate.intermediate.default / 100;
    const n = COACH.gainRate.noviceWeeks;
    expect(plannedWeight(70, 'none', 52)).toBeCloseTo(70 * r1 ** n * r2 ** (52 - n), 6);
    expect(plannedWeight(70, 'gt2y', 52)).toBeCloseTo(70 * r2 ** 52, 6);
    expect(plannedWeight(70, 'none', 10, 0.25)).toBeCloseTo(70 * 1.0025 ** 10, 6);
  });
  it('gives a 12-month default target rounded to 0.5 kg, and a weekly plan line', () => {
    const t = defaultTarget12m(70, 'none');
    expect(t * 2).toBe(Math.round(t * 2));
    expect(t).toBeGreaterThan(80);
    expect(t).toBeLessThan(90);
    const line = planLine('2026-11-01', 70, 'none');
    expect(line).toHaveLength(53);
    expect(line[1]).toEqual({ date: '2026-11-08', kg: 70 * (1 + COACH.gainRate.novice.default / 100) });
  });
});

describe('moving average and projection', () => {
  it('averages the last 7 calendar days, tolerating gaps', () => {
    const ma = movingAverage([
      { date: '2026-11-01', weightKg: 70 }, { date: '2026-11-03', weightKg: 72 },
      { date: '2026-11-07', weightKg: 71 }, { date: '2026-11-08', weightKg: 73 },
    ]);
    expect(ma.map((p) => p.kg)).toEqual([70, 71, 71, 72]); // 11-08 window: 11-02..11-08 → 72, 71, 73
  });
  it('projects a linear trend once there are two weeks of data, never before', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ date: addDays('2026-11-01', i), weightKg: 70 + i * 0.05 + (i % 2 ? 0.4 : -0.4) }));
    expect(projectTrend(pts.slice(0, 10), '2026-11-01')).toBeNull();
    const p = projectTrend(pts, '2026-11-01')!;
    expect(p.kgPerWeek).toBeGreaterThan(0.25);
    expect(p.kgPerWeek).toBeLessThan(0.45);
    expect(p.horizonDate).toBe(addDays('2026-11-01', 364));
    expect(p.atHorizonKg).toBeGreaterThan(85);
  });
});

describe('profile input', () => {
  const base = {
    sex: 'male', age: '29', heightCm: '178', weightKg: '68.5', waistCm: '80', experience: 'none', trainLocation: 'gym',
    daysPerWeek: '4', sessionMinutes: '60', dailyActivity: 'light', cookingMinutes: '30', budget: 'medium',
    mealsPerDay: '4', appetite: 'low', chestCm: '', targetGainPctWeek: '',
  };
  it('coerces form strings and fills defaults', () => {
    const v = ProfileInput.parse(base);
    expect(v).toMatchObject({ age: 29, weightKg: 68.5, cuisines: ['persian'], chestCm: undefined, targetGainPctWeek: undefined });
  });
  it('rejects impossible combinations', () => {
    expect(ProfileInput.safeParse({ ...base, trainLocation: 'home' }).success).toBe(false); // no equipment
    expect(ProfileInput.safeParse({ ...base, preferredDays: [0, 2] }).success).toBe(false); // 2 days for a 4-day plan
    expect(ProfileInput.safeParse({ ...base, targetWeight12mKg: '60' }).success).toBe(false); // below current weight
    expect(ProfileInput.safeParse({ ...base, daysPerWeek: '7' }).success).toBe(false);
  });
});
