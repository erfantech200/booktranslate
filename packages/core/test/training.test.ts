import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { EXERCISES } from '../src/data/exercises';
import { earlyDeloadReason, isLowReadiness, mustStop, readinessDeloadDue, recurringPain } from '../src/engine/autoreg';
import { availableEquipment, isEligible, maxDifficultyFor, TRACKED_MUSCLES, type Eligibility } from '../src/engine/library';
import {
  countVolume, deloadSets, generateProgram, PULL_PATTERNS, PUSH_PATTERNS, sessionMinutes, WEEKLY_PATTERNS,
  type ProgramInput,
} from '../src/engine/program';
import {
  bestsFrom, detectPRs, e1rm, isRegressing, isStalled, nextLoad, roundLoad, targetReps, type Exposure,
} from '../src/engine/progression';
import { mergeSessions, plannedDates, rescheduleOptions, trainingDays, weekday, weekState } from '../src/engine/schedule';
import { planSession, setsFor, summarize, targetRir, warmups, weekContext } from '../src/engine/session';

const T = COACH.training;
const bySlug = new Map(EXERCISES.map((e) => [e.slug, e]));
const ex = (slug: string) => bySlug.get(slug)!;

function input(o: Partial<ProgramInput> & { loc?: 'gym' | 'home'; equipment?: string[]; injuries?: string[]; seq?: number } = {}): ProgramInput {
  const experience = o.experience ?? 'none';
  const eligibility: Eligibility = {
    equipment: availableEquipment({ trainLocation: o.loc ?? 'gym', equipment: o.equipment ?? [] }),
    injuryAreas: o.injuries ?? [],
    excluded: new Set(),
    maxDifficulty: maxDifficultyFor(experience, o.seq ?? 1),
  };
  return { experience, daysPerWeek: o.daysPerWeek ?? 3, sessionMinutes: o.sessionMinutes ?? 60, library: EXERCISES, eligibility, avoid: o.avoid };
}

describe('program generator', () => {
  const cases = [3, 4, 5, 6].flatMap((days) => (['none', '6to24m'] as const).flatMap((experience) =>
    [45, 60, 75, 90].map((sessionMinutes) => ({ days, experience, sessionMinutes }))));

  it.each(cases)('$days days, $experience, $sessionMinutes min: complete, balanced and on time', ({ days, experience, sessionMinutes: mins }) => {
    const inp = input({ daysPerWeek: days, experience, sessionMinutes: mins });
    const p = generateProgram(inp);
    expect(p.days).toHaveLength(days);
    expect(p.weeks).toBe(T.mesocycleWeeks);
    expect(p.missing).toEqual([]);
    const all = p.days.flatMap((d) => d.exercises);
    for (const e of all) {
      expect(e.sets).toHaveLength(T.mesocycleWeeks - 1);
      expect(isEligible(ex(e.slug), inp.eligibility)).toBe(true);
    }
    for (let w = 0; w < T.mesocycleWeeks - 1; w++) {
      // Fits the session length every week.
      for (const d of p.days) expect(sessionMinutes(d.exercises.map((x) => ({ role: x.role, sets: x.sets[w]! })))).toBeLessThanOrEqual(mins);
      // Pulling ≥ pushing.
      const sum = (ps: readonly string[]) => all.filter((x) => ps.includes(ex(x.slug).pattern)).reduce((s, x) => s + x.sets[w]!, 0);
      expect(sum(PULL_PATTERNS)).toBeGreaterThanOrEqual(sum(PUSH_PATTERNS));
      // Caps.
      for (const x of all) expect(x.sets[w]).toBeLessThanOrEqual(T.maxSetsPerExercise);
      const vol = countVolume(all.map((x) => ({ slug: x.slug, sets: x.sets[w]! })), bySlug);
      for (const m of TRACKED_MUSCLES) expect(vol[m] ?? 0).toBeLessThanOrEqual(T.maxSetsPerMuscle);
      // Volume only ramps up within the block.
      if (w > 0) for (const x of all) expect(x.sets[w]).toBeGreaterThanOrEqual(x.sets[w - 1]!);
    }
    // Every weekly pattern is covered and every tracked muscle is trained on ≥ 2 days.
    const patterns = new Set(all.map((x) => ex(x.slug).pattern));
    for (const pt of WEEKLY_PATTERNS) expect(patterns.has(pt), pt).toBe(true);
    for (const m of TRACKED_MUSCLES) {
      const daysHit = p.days.filter((d) => d.exercises.some((x) => [...ex(x.slug).primary, ...ex(x.slug).secondary].includes(m))).length;
      expect(daysHit, m).toBeGreaterThanOrEqual(T.minFrequencyPerMuscle);
    }
    // Main lifts first in every session.
    for (const d of p.days) {
      const roles = d.exercises.map((x) => x.role);
      expect(roles.lastIndexOf('main')).toBeLessThan(Math.max(1, roles.indexOf('isolation') === -1 ? roles.length : roles.indexOf('isolation')));
    }
  });

  it('reaches the starting volume when there is time, and ramps it up', () => {
    const p = generateProgram(input({ daysPerWeek: 4, experience: 'none', seq: 2, sessionMinutes: 90 }));
    const target = T.startSetsPerMuscle.novice;
    for (const m of TRACKED_MUSCLES) expect(p.volume[0]![m], m).toBeGreaterThanOrEqual(target);
    const total = (w: number) => TRACKED_MUSCLES.reduce((s, m) => s + p.volume[w]![m], 0);
    expect(total(3)).toBeGreaterThan(total(0));
  });

  it('is deterministic', () => {
    expect(generateProgram(input({ daysPerWeek: 5 }))).toEqual(generateProgram(input({ daysPerWeek: 5 })));
  });

  it('gives novices stable variations first and barbell lifts later', () => {
    const slugs = (seq: number) => generateProgram(input({ daysPerWeek: 4, seq })).days.flatMap((d) => d.exercises.map((x) => x.slug));
    const first = slugs(1);
    for (const s of first) expect(ex(s).difficulty).toBe(1);
    expect(first).toContain('goblet-squat');
    expect(first).not.toContain('barbell-back-squat');
    expect(slugs(2)).toContain('barbell-back-squat');
  });

  it('leaves out contraindicated exercises for a reported lower-back problem', () => {
    const p = generateProgram(input({ daysPerWeek: 4, experience: 'gt2y', injuries: ['lower_back'] }));
    const slugs = p.days.flatMap((d) => d.exercises.map((x) => x.slug));
    for (const s of ['conventional-deadlift', 'good-morning', 'barbell-row']) expect(slugs).not.toContain(s);
    expect(p.missing).toEqual([]);
  });

  it('builds a home program from the listed equipment only', () => {
    const inp = input({ loc: 'home', equipment: ['dumbbells', 'bench', 'pullup_bar', 'bands'], daysPerWeek: 3 });
    const p = generateProgram(inp);
    for (const x of p.days.flatMap((d) => d.exercises)) {
      expect(ex(x.slug).equipment.some((set) => set.every((i) => inp.eligibility.equipment.has(i)))).toBe(true);
      expect(ex(x.slug).loadType).not.toBe('machine');
    }
    expect(p.missing).toEqual([]);
  });

  it('reports patterns it cannot fill', () => {
    const p = generateProgram(input({ loc: 'home', equipment: ['bands'], daysPerWeek: 4 }));
    expect(p.missing).toContain('vertical_pull');
  });

  it('moves stalled exercises to the back of the queue', () => {
    const p = generateProgram(input({ daysPerWeek: 3, avoid: new Set(['goblet-squat']) }));
    const slugs = p.days.flatMap((d) => d.exercises.map((x) => x.slug));
    expect(slugs).not.toContain('goblet-squat');
  });

  it('halves sets in the deload week', () => {
    expect(deloadSets(4)).toBe(2);
    expect(deloadSets(3)).toBe(2);
    expect(deloadSets(1)).toBe(1);
  });
});

describe('progression', () => {
  const x = (sets: [number, number, number | null][], reps: [number, number] = [8, 12], targetRir = 2, deload = false): Exposure =>
    ({ date: '2026-01-01', sets: sets.map(([weight, r, rir]) => ({ weight, reps: r, rir })), reps, targetRir, deload });
  const bench = ex('barbell-bench-press'), squat = ex('barbell-back-squat'), db = ex('dumbbell-bench-press');

  it('computes Epley e1RM only for 1–12 reps', () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 2);
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(60, 13)).toBeNull();
    expect(e1rm(0, 5)).toBeNull();
  });

  it('calibrates on the first exposure', () => {
    expect(nextLoad(bench, [])).toEqual({ kind: 'calibrate', load: null });
  });

  it('adds the smallest increment when every set hits the top of the range at the target RIR', () => {
    expect(nextLoad(bench, [x([[60, 12, 2], [60, 12, 2], [60, 12, 1]])])).toEqual({ kind: 'increase', load: 62.5, from: 60 });
    expect(nextLoad(squat, [x([[80, 12, 2], [80, 12, 2]])])).toEqual({ kind: 'increase', load: 85, from: 80 });
    expect(nextLoad(db, [x([[20, 12, null], [20, 12, null]])])).toEqual({ kind: 'increase', load: 22, from: 20 });
  });

  it('holds when a set misses the top or effort was too high', () => {
    expect(nextLoad(bench, [x([[60, 12, 2], [60, 11, 2]])]).kind).toBe('hold');
    expect(nextLoad(bench, [x([[60, 12, 0], [60, 12, 0]])]).kind).toBe('hold');
  });

  it('reduces 5–10 % after two sessions below the range at the same load', () => {
    const bad = x([[60, 6, 0], [60, 6, 0], [60, 5, 0]]);
    expect(nextLoad(bench, [bad]).kind).toBe('hold');
    const d = nextLoad(bench, [bad, bad]);
    expect(d.kind).toBe('reduce');
    expect(d.load).toBe(55);
    expect(d.load! / 60).toBeGreaterThanOrEqual(0.9);
  });

  it('ignores deload sessions', () => {
    const good = x([[60, 12, 2], [60, 12, 2]]);
    const deload = x([[60, 6, 4]], [8, 12], 4, true);
    expect(nextLoad(bench, [good, deload]).kind).toBe('increase');
  });

  it('suggests a harder variation for bodyweight and timed work at the top of the range', () => {
    expect(nextLoad(ex('push-up'), [x([[0, 20, 2], [0, 20, 2]], [8, 20])]).kind).toBe('variation');
    expect(nextLoad(ex('plank'), [x([[0, 45, null]], [20, 45])]).kind).toBe('variation');
    expect(nextLoad(ex('push-up'), []).kind).toBe('hold');
  });

  it('rounds loads to what can be loaded', () => {
    expect(roundLoad(61.3, bench)).toBe(62.5);
    expect(roundLoad(10, bench)).toBe(T.emptyBarKg);
    expect(roundLoad(13.6, db)).toBe(14);
    expect(roundLoad(55.5, bench, 'down')).toBe(55);
  });

  it('pre-fills the target reps', () => {
    expect(targetReps({ kind: 'increase', load: 62.5, from: 60 }, [8, 12], null, 0)).toBe(8);
    expect(targetReps({ kind: 'hold', load: 60 }, [8, 12], [{ weight: 60, reps: 9, rir: 2 }, { weight: 60, reps: 8, rir: 1 }], 1)).toBe(9);
    expect(targetReps({ kind: 'hold', load: 60 }, [8, 12], [{ weight: 60, reps: 12, rir: 2 }], 0)).toBe(12);
  });

  it('detects a stall after three exposures without an e1RM gain', () => {
    const at = (r: number) => x([[100, r, 2]]);
    expect(isStalled([at(8), at(8), at(7), at(8)])).toBe(true);
    expect(isStalled([at(8), at(8), at(9), at(8)])).toBe(false);
    expect(isStalled([at(8), at(8), at(8)])).toBe(false);
  });

  it('detects a regressing lift', () => {
    const at = (r: number) => x([[100, r, 2]]);
    expect(isRegressing([at(8), at(7), at(6)])).toBe(true);
    expect(isRegressing([at(8), at(7), at(7)])).toBe(false);
  });

  it('detects load, reps-at-load and e1RM PRs', () => {
    const b = bestsFrom([{ weight: 60, reps: 8, rir: 2 }, { weight: 62.5, reps: 5, rir: 1 }]);
    expect(detectPRs({ weight: 65, reps: 3, rir: 1 }, b)).toEqual(['load']);
    expect(detectPRs({ weight: 60, reps: 9, rir: 1 }, b)).toEqual(['reps', 'e1rm']);
    expect(detectPRs({ weight: 50, reps: 8, rir: 1 }, b)).toEqual([]);
    expect(detectPRs({ weight: 60, reps: 8, rir: 1 }, bestsFrom([]))).toEqual([]);
  });
});

describe('session prescription', () => {
  const meso = { seq: 1, startDate: '2026-10-24', weeks: 5, deloadWeek: 5 };

  it('follows the RIR wave with technique weeks for novices', () => {
    const wc = (date: string, experience: 'none' | 'gt2y' = 'none', m = meso) => weekContext(m, experience, date);
    expect(wc('2026-10-24')).toEqual({ week: 1, deload: false, technique: true });
    expect(targetRir('main', wc('2026-10-24'))).toBe(T.techniqueRir);
    expect(targetRir('main', wc('2026-10-24', 'gt2y'))).toBe(3);
    expect(targetRir('main', wc('2026-11-07'))).toBe(1.5);
    expect(targetRir('main', wc('2026-11-14'))).toBe(1);
    expect(targetRir('isolation', wc('2026-11-14'))).toBe(0);
    expect(wc('2026-11-21').deload).toBe(true);
    expect(targetRir('main', wc('2026-11-21'))).toBe(T.deload.rir);
    // Early deload: the deload week moves forward.
    expect(wc('2026-11-07', 'none', { ...meso, deloadWeek: 3 }).deload).toBe(true);
    // Technique weeks only in the very first block.
    expect(wc('2026-10-24', 'none', { ...meso, seq: 2 }).technique).toBe(false);
  });

  it('picks the week’s sets, holds the ramp and drops a set on low readiness', () => {
    const sets = [3, 4, 4, 5];
    const w = (week: number, deload = false) => ({ week, deload, technique: false });
    expect(setsFor(sets, w(1))).toBe(3);
    expect(setsFor(sets, w(4))).toBe(5);
    expect(setsFor(sets, w(4), { holdRamp: true })).toBe(4);
    expect(setsFor(sets, w(2), { lowReadiness: true })).toBe(3);
    expect(setsFor([1], w(1), { lowReadiness: true })).toBe(1);
    expect(setsFor(sets, w(5, true))).toBe(2);
  });

  it('ramps up to the first compound lift', () => {
    expect(warmups(ex('barbell-back-squat'), 'main', 100, true).map((w) => [w.weight, w.reps])).toEqual([[40, 8], [60, 5], [80, 3]]);
    expect(warmups(ex('barbell-bench-press'), 'main', 60, false).map((w) => w.weight)).toEqual([35, 47.5]);
    expect(warmups(ex('barbell-bench-press'), 'main', 25, false).map((w) => w.weight)).toEqual([20]);
    expect(warmups(ex('barbell-back-squat'), 'main', null, true).every((w) => w.weight === null)).toBe(true);
    expect(warmups(ex('cable-pushdown'), 'isolation', 30, true)).toEqual([]);
  });

  it('plans a session with loads from history', () => {
    const history = new Map([['barbell-bench-press', [{
      date: '2026-10-20', reps: [6, 10] as [number, number], targetRir: 2,
      sets: [{ weight: 60, reps: 10, rir: 2 }, { weight: 60, reps: 10, rir: 2 }, { weight: 60, reps: 10, rir: 2 }],
    }]]]);
    const plan = planSession(['upper_a'], [
      { slug: 'barbell-bench-press', role: 'main', sets: 3, reps: [6, 10], restSec: 150 },
      { slug: 'seated-cable-row', role: 'main', sets: 3, reps: [6, 10], restSec: 150 },
      { slug: 'cable-pushdown', role: 'isolation', sets: 2, reps: [10, 15], restSec: 60 },
    ], { bySlug, wc: { week: 2, deload: false, technique: false }, history, bests: new Map(), injuryAreas: ['shoulder'] }, false);
    const [b, r, c] = plan.exercises;
    expect(b!.decision).toBe('increase');
    expect(b!.load).toBe(62.5);
    expect(b!.warmups).toHaveLength(3);
    expect(b!.targets).toEqual([6, 6, 6]);
    expect(b!.caution).toBe(true);
    expect(r!.decision).toBe('calibrate');
    expect(r!.warmups.length).toBe(2);
    expect(c!.warmups).toEqual([]);
    expect(plan.estMinutes).toBe(Math.round(T.warmupMinutes + 6 * T.minutesPerSet.heavy + 2 * T.minutesPerSet.other));
  });

  it('summarizes a finished session', () => {
    const s = summarize({
      startedAt: '2026-10-26T10:00:00Z', finishedAt: '2026-10-26T10:55:00Z',
      bestsBefore: new Map([['barbell-bench-press', bestsFrom([{ weight: 60, reps: 8, rir: 2 }])]]),
      bySlug,
      sets: [
        { slug: 'barbell-bench-press', weight: 40, reps: 5, rir: null, isWarmup: true, loggedAt: '2026-10-26T10:05:00Z' },
        { slug: 'barbell-bench-press', weight: 62.5, reps: 8, rir: 2, isWarmup: false, loggedAt: '2026-10-26T10:10:00Z' },
        { slug: 'barbell-bench-press', weight: 62.5, reps: 7, rir: 1, isWarmup: false, loggedAt: '2026-10-26T10:13:00Z' },
        { slug: 'plank', weight: 0, reps: 40, rir: null, isWarmup: false, loggedAt: '2026-10-26T10:50:00Z' },
      ],
    });
    expect(s.minutes).toBe(55);
    expect(s.workingSets).toBe(3);
    expect(s.volumeKg).toBe(Math.round(62.5 * 15));
    expect(s.setsPerMuscle.chest).toBe(2);
    expect(s.setsPerMuscle.triceps).toBe(1);
    expect(s.prs).toEqual([{ slug: 'barbell-bench-press', kinds: ['load', 'e1rm'], weight: 62.5, reps: 8 }]);
  });
});

describe('schedule', () => {
  it('maps dates to Persian weekdays (0 = Saturday)', () => {
    expect(weekday('2026-10-24')).toBe(0);
    expect(weekday('2026-10-30')).toBe(6);
  });

  it('uses preferred days only when they match the frequency', () => {
    expect(trainingDays(3, [])).toEqual([0, 2, 4]);
    expect(trainingDays(3, [5, 1, 3])).toEqual([1, 3, 5]);
    expect(trainingDays(4, [1, 3])).toEqual([0, 1, 3, 4]);
  });

  it('plans one session per training weekday in each 7-day window', () => {
    // Block started on a Monday; training days Sat/Mon/Wed.
    expect(plannedDates('2026-10-26', 1, [0, 2, 4], 3)).toEqual(['2026-10-26', '2026-10-28', '2026-10-31']);
    expect(plannedDates('2026-10-26', 2, [0, 2, 4], 3)).toEqual(['2026-11-02', '2026-11-04', '2026-11-07']);
  });

  const base = { startDate: '2026-10-24', days: [0, 2, 4], programDays: 3 };
  it('follows the program as a queue and flags a late session', () => {
    expect(weekState({ ...base, today: '2026-10-24', handled: new Set() })).toMatchObject({ next: { dayIdx: 0, planned: '2026-10-24' }, dueToday: true, late: false });
    expect(weekState({ ...base, today: '2026-10-25', handled: new Set([0]) })).toMatchObject({ next: { dayIdx: 1, planned: '2026-10-26' }, late: false, dueToday: false });
    const late = weekState({ ...base, today: '2026-10-27', handled: new Set([0]) });
    expect(late).toMatchObject({ next: { dayIdx: 1 }, late: true, remainingSessions: 2, remainingSlots: 1 });
    expect(rescheduleOptions(late)).toEqual(['shift', 'merge', 'skip']);
    // A missed day with enough training days left in the week: no merge.
    const lateButRoom = weekState({ ...base, days: [0, 1, 3, 4], today: '2026-10-25', handled: new Set() });
    expect(lateButRoom.late).toBe(true);
    expect(rescheduleOptions(lateButRoom)).toEqual(['shift', 'skip']);
    expect(weekState({ ...base, today: '2026-10-29', handled: new Set([0, 1, 2]) }).next).toBeNull();
    expect(weekState({ ...base, today: '2026-10-31', handled: new Set() }).week).toBe(2);
  });

  it('merges two sessions without doubling volume', () => {
    const a = [
      { slug: 'goblet-squat', role: 'main' as const, sets: 3, pattern: 'squat' },
      { slug: 'dumbbell-bench-press', role: 'main' as const, sets: 3, pattern: 'horizontal_push' },
      { slug: 'lat-pulldown', role: 'accessory' as const, sets: 3, pattern: 'vertical_pull' },
      { slug: 'cable-pushdown', role: 'isolation' as const, sets: 2, pattern: 'triceps' },
    ];
    const b = [
      { slug: 'dumbbell-romanian-deadlift', role: 'main' as const, sets: 3, pattern: 'hinge' },
      { slug: 'seated-cable-row', role: 'accessory' as const, sets: 3, pattern: 'horizontal_pull' },
      { slug: 'dumbbell-curl', role: 'isolation' as const, sets: 2, pattern: 'biceps' },
      { slug: 'leg-press', role: 'accessory' as const, sets: 3, pattern: 'squat' },
    ];
    const m = mergeSessions(a, b, 90);
    const total = m.reduce((s, x) => s + x.sets, 0);
    expect(total).toBeLessThanOrEqual(11);
    expect(m.filter((x) => x.role === 'main').map((x) => x.slug)).toEqual(['goblet-squat', 'dumbbell-bench-press', 'dumbbell-romanian-deadlift']);
    expect(new Set(m.map((x) => x.pattern)).size).toBe(m.length);
    expect(sessionMinutes(mergeSessions(a, b, 45))).toBeLessThanOrEqual(45);
  });
});

describe('autoregulation and pain', () => {
  it('flags low readiness', () => {
    expect(isLowReadiness({ sleepHours: 5.5, energy: 4, soreness: 2 })).toBe(true);
    expect(isLowReadiness({ sleepHours: 8, energy: 2, soreness: 2 })).toBe(true);
    expect(isLowReadiness({ sleepHours: 8, energy: 3, soreness: 4 })).toBe(true);
    expect(isLowReadiness({ sleepHours: 7, energy: 3, soreness: 3 })).toBe(false);
    expect(isLowReadiness({ sleepHours: null, energy: null, soreness: null })).toBe(false);
  });

  const low = (date: string) => ({ date, sleepHours: 5, energy: 2, soreness: 4 });
  const ok = (date: string) => ({ date, sleepHours: 8, energy: 4, soreness: 2 });

  it('calls an early deload after a week of low readiness', () => {
    const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
    expect(readinessDeloadDue(days.map((d, i) => (i < 5 ? low(d) : ok(d))), '2026-10-26')).toBe(true);
    expect(readinessDeloadDue(days.map((d, i) => (i < 4 ? low(d) : ok(d))), '2026-10-26')).toBe(false);
    expect(readinessDeloadDue(days.map(low), '2026-11-10')).toBe(false);
  });

  it('calls an early deload when two main lifts regress for two sessions', () => {
    const x = (r: number): Exposure => ({ date: '2026-10-01', reps: [6, 10], targetRir: 2, sets: [{ weight: 100, reps: r, rir: 1 }] });
    const down = [x(8), x(7), x(6)], flat = [x(8), x(8), x(8)];
    expect(earlyDeloadReason({ mainLifts: [down, down, flat], readiness: [], today: '2026-10-26' })).toBe('regression');
    expect(earlyDeloadReason({ mainLifts: [down, flat], readiness: [], today: '2026-10-26' })).toBeNull();
  });

  it('stops an exercise at pain ≥ 4 or sharp pain', () => {
    expect(mustStop(3, false)).toBe(false);
    expect(mustStop(4, false)).toBe(true);
    expect(mustStop(1, true)).toBe(true);
  });

  it('recommends a physiotherapist for recurring pain in one area', () => {
    const r = [{ date: '2026-10-10', area: 'knee', level: 3 }, { date: '2026-10-20', area: 'knee', level: 5 }, { date: '2026-10-20', area: 'shoulder', level: 2 }];
    expect(recurringPain(r, 'knee', '2026-10-26')).toBe(true);
    expect(recurringPain(r, 'shoulder', '2026-10-26')).toBe(false);
    expect(recurringPain(r, 'knee', '2026-12-26')).toBe(false);
  });
});
