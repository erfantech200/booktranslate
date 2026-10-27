import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { EXERCISES } from '../src/data/exercises';
import { FOODS } from '../src/data/foods';
import { fakeData } from '../src/dev/fakeData';
import {
  e1rmSeries, gainQuality, measurementStatus, muscleVolume, nutritionAdherence, photoStatus, streak, strengthChangePct,
  timeline, weekOfDate, weeklyVolume, workoutAdherence, type Measurement, type WorkSet,
} from '../src/engine/progress';
import { addDays } from '../src/engine/weight';

const P = COACH.progress;
const bySlug = new Map(EXERCISES.map((e) => [e.slug, e]));
const m = (date: string, waist: number | null, rest: Partial<Measurement> = {}): Measurement =>
  ({ date, waist, chest: null, arm: null, thigh: null, ...rest });

describe('due dates', () => {
  it('measurements are due on the first day and every measurementEveryDays after', () => {
    expect(measurementStatus([], '2026-10-27')).toEqual({ last: null, next: '2026-10-27', due: true });
    const ms = [m('2026-10-01', 80), m('2026-10-20', null)]; // a weight-only row doesn't count
    const s = measurementStatus(ms, '2026-10-14');
    expect(s).toEqual({ last: '2026-10-01', next: addDays('2026-10-01', P.measurementEveryDays), due: false });
    expect(measurementStatus(ms, '2026-10-15').due).toBe(true);
  });
  it('photos are due after photoDueDays and overdue after photoOverdueDays', () => {
    expect(photoStatus([], '2026-10-27')).toMatchObject({ last: null, due: true, overdue: true });
    const d = ['2026-09-01', '2026-10-01'];
    expect(photoStatus(d, addDays('2026-10-01', P.photoDueDays - 1))).toMatchObject({ last: '2026-10-01', due: false, overdue: false });
    expect(photoStatus(d, addDays('2026-10-01', P.photoDueDays))).toMatchObject({ due: true, overdue: false });
    expect(photoStatus(d, addDays('2026-10-01', P.photoOverdueDays))).toMatchObject({ due: true, overdue: true });
  });
});

describe('strength', () => {
  const sets: WorkSet[] = [
    { date: '2026-10-01', slug: 'goblet-squat', weight: 20, reps: 10 },
    { date: '2026-10-01', slug: 'goblet-squat', weight: 22, reps: 8 },
    { date: '2026-10-01', slug: 'goblet-squat', weight: 30, reps: 20 }, // too many reps for an e1RM
    { date: '2026-10-08', slug: 'goblet-squat', weight: 24, reps: 10 },
    { date: '2026-10-08', slug: 'plank', weight: 0, reps: 45 },
  ];
  it('keeps the best e1RM per session date', () => {
    expect(e1rmSeries(sets, 'goblet-squat')).toEqual([{ date: '2026-10-01', kg: 27.9 }, { date: '2026-10-08', kg: 32 }]);
    expect(e1rmSeries(sets, 'plank')).toEqual([]);
  });
  it('averages relative change between the window halves, skipping lifts missing from a half', () => {
    const pct = strengthChangePct(sets, ['goblet-squat', 'plank'], '2026-09-30', '2026-10-10');
    expect(pct).toBeCloseTo((32 / 27.9 - 1) * 100, 5); // from the rounded series
    expect(strengthChangePct(sets, ['plank'], '2026-09-30', '2026-10-10')).toBeNull();
  });
  it('sums tonnage and sets per Saturday week, with half credit for secondary muscles', () => {
    expect(weekOfDate('2026-10-27')).toBe('2026-10-24'); // Tuesday → the Saturday before
    expect(weekOfDate('2026-10-24')).toBe('2026-10-24');
    const w = weeklyVolume([
      { date: '2026-10-24', slug: 'goblet-squat', weight: 20, reps: 10 },
      { date: '2026-10-26', slug: 'goblet-squat', weight: 20, reps: 10 },
      { date: '2026-10-31', slug: 'goblet-squat', weight: 20, reps: 10 },
    ], bySlug);
    expect(w.map((x) => [x.week, x.tonnage, x.sets])).toEqual([['2026-10-24', 400, 2], ['2026-10-31', 200, 1]]);
    const e = bySlug.get('goblet-squat')!;
    for (const mu of e.primary) expect(w[0]!.muscles[mu]).toBe(2);
    for (const mu of e.secondary) expect(w[0]!.muscles[mu]).toBe(1);
  });
  it('rates weekly sets per muscle against the program range', () => {
    const lo = COACH.training.startSetsPerMuscle.novice;
    const v = muscleVolume({ chest: lo - 1, quads: lo, lats: COACH.training.maxSetsPerMuscle + 1 }, true);
    const by = Object.fromEntries(v.map((x) => [x.muscle, x.status]));
    expect(by).toMatchObject({ chest: 'low', quads: 'ok', lats: 'high', abs: 'low' });
    expect(muscleVolume(undefined, false)[0]!.lo).toBe(COACH.training.startSetsPerMuscle.intermediate);
    // Against the block's plan: 7.5 of 8 planned is within rounding, an unplanned muscle is fine at 0.
    const p = Object.fromEntries(muscleVolume({ chest: 7.5, quads: 5 }, true, { chest: 8, quads: 8 }).map((x) => [x.muscle, [x.lo, x.status]]));
    expect(p).toMatchObject({ chest: [8, 'ok'], quads: [8, 'low'], calves: [0, 'ok'] });
  });
});

describe('gain quality', () => {
  const today = '2026-10-27';
  const weighIns = (gain: number) => Array.from({ length: 36 }, (_, i) => ({ date: addDays(today, i - 35), weightKg: 70 + (gain * i) / 35 }));
  const waist = (cm: number) => [m(addDays(today, -28), 80), m(addDays(today, -14), 80 + cm / 2), m(today, 80 + cm)];
  const lifts = (pct: number): WorkSet[] => [
    { date: addDays(today, -25), slug: 'goblet-squat', weight: 20, reps: 10 },
    { date: addDays(today, -2), slug: 'goblet-squat', weight: 20 * (1 + pct / 100), reps: 10 },
  ];
  const q = (gain: number, cm: number, pct: number) =>
    gainQuality({ weighIns: weighIns(gain), measurements: waist(cm), sets: lifts(pct), mainLifts: ['goblet-squat'], today });

  it('good: waist barely moves per kg and strength rises', () => {
    const r = q(1.2, 0.3, 8);
    expect(r.level).toBe('good');
    expect(r.waistChangeCm).toBe(0.3);
    expect(r.strengthChangePct).toBeCloseTo(8, 0);
  });
  it('ok: a bit more waist per kg, or strength flat with a small waist change', () => {
    expect(q(1.2, 0.9, 8).level).toBe('ok');
  });
  it('watch: waist grows fast per kg, or strength falls while the waist grows', () => {
    expect(q(1, 1.5, 8).level).toBe('watch');
    expect(q(1.2, 0.8, -3).level).toBe('watch');
  });
  it('insufficient: too little weight change or missing measurements', () => {
    expect(q(0.2, 0.3, 8).level).toBe('insufficient');
    expect(gainQuality({ weighIns: weighIns(1.2), measurements: [], sets: [], mainLifts: [], today }).level).toBe('insufficient');
    // Weigh-ins only from the last two weeks: no 3-week span to judge.
    expect(gainQuality({ weighIns: weighIns(1.2).slice(-14), measurements: waist(0.3), sets: [], mainLifts: [], today }).weightChangeKg).toBeNull();
  });
});

describe('adherence and streaks', () => {
  it('counts protein and calorie hits on logged days only', () => {
    const r = nutritionAdherence([
      { date: 'a', kcal: 2800, protein: 140 },
      { date: 'b', kcal: 2400, protein: 120 },
      { date: 'c', kcal: 0, protein: 0 },
      { date: 'd', kcal: 3000, protein: 150 },
    ], (d) => (d === 'd' ? null : { kcal: 2800, protein: 140 }));
    expect(r).toEqual({ logged: 2, proteinHit: 1, kcalHit: 1 });
  });
  it('compares workouts done per week with the plan', () => {
    expect(workoutAdherence(['2026-10-24', '2026-10-26', '2026-10-31'], ['2026-10-24', '2026-10-31'], 4))
      .toEqual([{ week: '2026-10-24', planned: 4, done: 2 }, { week: '2026-10-31', planned: 4, done: 1 }]);
  });
  it('counts consecutive days ending today, or yesterday when today has nothing yet', () => {
    expect(streak(['2026-10-25', '2026-10-26', '2026-10-27'], '2026-10-27')).toBe(3);
    expect(streak(['2026-10-25', '2026-10-26'], '2026-10-27')).toBe(2);
    expect(streak(['2026-10-24', '2026-10-26'], '2026-10-27')).toBe(1);
    expect(streak([], '2026-10-27')).toBe(0);
  });
});

describe('timeline', () => {
  const t = timeline({
    startDate: '2026-09-01',
    startWeightKg: 68,
    weighIns: [{ date: '2026-09-01', weightKg: 68 }, ...Array.from({ length: 50 }, (_, i) => ({ date: addDays('2026-09-02', i), weightKg: 68 + i * 0.1 }))],
    blocks: [{ blockNo: 1, start: '2026-09-01', end: '2026-10-06' }, { blockNo: 2, start: '2026-10-06', end: null }],
    prs: [
      { date: '2026-09-10', slug: 'goblet-squat', weight: 16, reps: 10 },
      { date: '2026-09-10', slug: 'goblet-squat', weight: 18, reps: 8 },
      { date: '2026-09-10', slug: 'dumbbell-bench-press', weight: 12, reps: 10 },
      { date: '2026-09-09', slug: 'goblet-squat', weight: 16, reps: 12 },
      { date: '2026-09-14', slug: 'goblet-squat', weight: 20, reps: 6 }, // the next week (Saturday 09-12 onwards)
    ],
    photos: [{ date: '2026-09-01', angle: 'front' }, { date: '2026-09-01', angle: 'side' }],
    workouts: Array.from({ length: 12 }, (_, i) => addDays('2026-09-02', i * 3)),
    measurements: [m('2026-09-01', 80), m('2026-09-15', null)],
  });

  it('is newest first and starts with the start event at the bottom', () => {
    expect(t.at(-1)).toMatchObject({ kind: 'start', date: '2026-09-01' });
    expect([...t].sort((a, b) => b.date.localeCompare(a.date)).map((e) => e.date)).toEqual(t.map((e) => e.date));
  });
  it('gathers records into one entry per week, each exercise once with its heaviest set', () => {
    const prs = t.filter((e) => e.kind === 'prs');
    expect(prs).toHaveLength(2);
    const w2 = prs.find((e) => e.date === '2026-09-10');
    expect(w2).toMatchObject({ items: [{ slug: 'goblet-squat', weight: 18, reps: 8 }, { slug: 'dumbbell-bench-press', weight: 12, reps: 10 }] });
    expect(prs.find((e) => e.date === '2026-09-14')).toMatchObject({ items: [{ slug: 'goblet-squat', weight: 20, reps: 6 }] });
  });
  it('marks weight milestones every weightMilestoneKg on the trend, and workout-count milestones', () => {
    const w = t.filter((e) => e.kind === 'weight');
    expect(w.map((e) => e.kind === 'weight' && e.gained)).toEqual([P.weightMilestoneKg * 2, P.weightMilestoneKg]);
    expect(t.filter((e) => e.kind === 'workouts').map((e) => e.kind === 'workouts' && e.count)).toEqual([10, 1]);
    expect(t.filter((e) => e.kind === 'photos')).toEqual([{ date: '2026-09-01', kind: 'photos', angles: ['front', 'side'] }]);
    expect(t.filter((e) => e.kind === 'measure')).toHaveLength(1);
    expect(t.filter((e) => e.kind === 'block')).toHaveLength(2);
  });
});

describe('dev fake data', () => {
  const o = { userId: '00000000-0000-0000-0000-000000000001', today: '2026-10-27', library: EXERCISES, foods: FOODS };
  const d = fakeData(o);

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(fakeData(o))).toBe(JSON.stringify(d));
    expect(JSON.stringify(fakeData({ ...o, seed: 7 }))).not.toBe(JSON.stringify(d));
  });
  it('is internally consistent and stays inside the schema bounds', () => {
    const sessions = new Set(d.workout_sessions.map((s) => s.id));
    expect(d.set_logs.every((s) => sessions.has(s.session_id))).toBe(true);
    const days = new Set(d.program_days.map((x) => x.id));
    expect(d.program_exercises.every((x) => days.has(x.program_day_id))).toBe(true);
    expect(new Set(d.body_metrics.map((b) => b.date)).size).toBe(d.body_metrics.length);
    expect(d.body_metrics.every((b) => (b.date as string) < o.today)).toBe(true);
    expect(d.workout_sessions.every((s) => (s.date as string) < o.today)).toBe(true);
    expect(d.mesocycles.filter((x) => x.status === 'active')).toHaveLength(1);
    const foods = new Set(FOODS.map((f) => f.id));
    expect(d.food_logs.every((f) => foods.has(f.food_id as string))).toBe(true);
    const ids = [...d.body_metrics, ...d.workout_sessions, ...d.set_logs, ...d.food_logs].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('shows a lifter getting stronger with a lean gain', () => {
    const date = new Map(d.workout_sessions.map((s) => [s.id, s.date as string]));
    const sets = d.set_logs.map((s) => ({ date: date.get(s.session_id)!, slug: s.slug as string, weight: s.weight_kg as number, reps: s.reps as number }));
    const mains = [...new Set(d.program_exercises.filter((x) => x.role === 'main').map((x) => x.slug as string))];
    const q = gainQuality({
      weighIns: d.body_metrics.map((b) => ({ date: b.date as string, weightKg: b.weight_kg as number })),
      measurements: d.body_metrics.map((b) => ({ date: b.date as string, waist: b.waist_cm as number | null, chest: null, arm: null, thigh: null })),
      sets, mainLifts: mains, today: o.today,
    });
    expect(q.weightChangeKg).toBeGreaterThan(P.qualityMinWeightChangeKg);
    expect(q.strengthChangePct).toBeGreaterThan(0);
    expect(['good', 'ok']).toContain(q.level);
  });
});
