import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { daySupplements, isTrainingDate } from '../src/engine/supplements';

describe('daily supplements', () => {
  const meals = [
    { nameFa: 'صبحانه', items: [{ food: 'egg', grams: 100 }] },
    { nameFa: 'شیک', items: [{ food: 'whey', grams: 30 }, { food: 'milk-whole', grams: 300 }] },
    { nameFa: 'عصرانه', items: [{ food: 'whey', grams: 15 }] },
  ];

  it('creatine is the same dose on training and rest days, inside the 3–5 g range', () => {
    const train = daySupplements({ meals, training: true, unitG: 30 });
    const rest = daySupplements({ meals, training: false, unitG: 30 });
    expect(train.creatineG).toBe(rest.creatineG);
    expect(train.creatineG).toBeGreaterThanOrEqual(COACH.supplements.creatineGramsMin);
    expect(train.creatineG).toBeLessThanOrEqual(COACH.supplements.creatineGramsMax);
  });

  it('protein powder comes from the plan only, in grams and half scoops', () => {
    expect(daySupplements({ meals, training: true, unitG: 30 }).proteinPowder).toEqual({ grams: 45, units: 1.5, meals: ['شیک', 'عصرانه'] });
    expect(daySupplements({ meals: meals.slice(0, 1), training: true }).proteinPowder).toBeNull();
    expect(daySupplements({ meals, training: null }).proteinPowder?.units).toBeNull();
  });

  it('training day: a workout that day wins, past days without one were rest, future days follow the weekdays', () => {
    const base = { today: '2026-11-03', trainingWeekdays: [0, 2, 4], sessions: [] as { date: string; status: 'active' | 'done' | 'skipped' }[] };
    expect(isTrainingDate({ ...base, date: '2026-11-07' })).toBe(true); // Saturday
    expect(isTrainingDate({ ...base, date: '2026-11-08' })).toBe(false); // Sunday
    expect(isTrainingDate({ ...base, date: '2026-11-01' })).toBe(false); // past Saturday with no workout
    expect(isTrainingDate({ ...base, date: '2026-11-02', sessions: [{ date: '2026-11-02', status: 'done' }] })).toBe(true); // extra day trained
    expect(isTrainingDate({ ...base, date: '2026-11-07', sessions: [{ date: '2026-11-07', status: 'skipped' }] })).toBe(false);
    expect(isTrainingDate({ ...base, date: '2026-11-03', sessions: [{ date: '2026-11-03', status: 'active' }] })).toBe(true);
  });
});
