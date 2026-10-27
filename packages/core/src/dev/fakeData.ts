import { COACH } from '../coach.config';
import type { Eligibility, Exercise } from '../engine/library';
import { availableEquipment, maxDifficultyFor } from '../engine/library';
import { computeTargets, macrosOf, type Food } from '../engine/nutrition';
import { generateProgram } from '../engine/program';
import { addToBests, emptyBests, type Bests, type Exposure } from '../engine/progression';
import { plannedDates, trainingDays } from '../engine/schedule';
import { planSession, setsFor, summarize, weekContext } from '../engine/session';
import { addDays, type Experience } from '../engine/weight';

// Dev-only: realistic fake history (spec §16) so every chart and the check-in can be reviewed
// before real use. Built by running the real engine week by week: the program generator,
// prescriptions and double progression decide the loads; a simple noisy "lifter" performs them.
// Deterministic for a given seed.

type Row = Record<string, unknown>;
export interface FakeData {
  profile: Row;
  body_metrics: Row[];
  mesocycles: Row[];
  program_days: Row[];
  program_exercises: Row[];
  workout_sessions: Row[];
  set_logs: Row[];
  readiness: Row[];
  nutrition_targets: Row[];
  food_logs: Row[];
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return {
    next,
    between: (a: number, b: number) => a + (b - a) * next(),
    chance: (p: number) => next() < p,
    uuid: () => {
      const h = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      h[12] = '4';
      h[16] = '89ab'[Math.floor(next() * 4)]!;
      const x = h.join('');
      return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
    },
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function fakeData(o: {
  userId: string;
  today: string;
  library: readonly Exercise[];
  foods: readonly Food[];
  weeks?: number;
  seed?: number;
  experience?: Experience;
}): FakeData {
  const R = rng(o.seed ?? 42);
  const weeks = o.weeks ?? 8;
  const start = addDays(o.today, -weeks * 7);
  const experience: Experience = o.experience ?? 'none';
  const startKg = 68.4;
  const days = trainingDays(4, [0, 1, 3, 5]);
  const profile = {
    user_id: o.userId, onboarded_at: `${start}T08:00:00Z`, sex: 'male', birth_year: Number(o.today.slice(0, 4)) - 29, height_cm: 178,
    experience, train_location: 'gym', equipment: [], days_per_week: 4, session_minutes: 60, preferred_days: days,
    injury_areas: ['lower_back'], injury_notes: 'گاهی کمردرد خفیف بعد از نشستن طولانی', cardio_risk: false, daily_activity: 'light',
    cuisines: ['persian'], cooking_minutes: 45, budget: 'medium', meals_per_day: 4, appetite: 'low',
    start_date: start, start_weight_kg: startKg, theme: 'dark', digits: 'latin',
  };

  // ─── Bodyweight and measurements ──────────────────────────────────────────────────────
  const body_metrics: Row[] = [];
  const kgAt = (d: number) => startKg * (1 + COACH.gainRate.novice.default / 100) ** (d / 7) + Math.sin(d / 9) * 0.25;
  for (let d = 0; d < weeks * 7; d++) {
    const date = addDays(start, d);
    const measure = d % COACH.progress.measurementEveryDays === 0;
    if (!R.chance(0.86) && !measure) continue;
    const gained = kgAt(d) - startKg;
    body_metrics.push({
      id: R.uuid(), user_id: o.userId, date, weight_kg: r2(kgAt(d) + R.between(-0.6, 0.6)),
      waist_cm: measure ? r1(81 + gained * 0.4 + R.between(-0.3, 0.3)) : null,
      chest_cm: measure ? r1(94 + gained * 0.7 + R.between(-0.4, 0.4)) : null,
      arm_cm: measure ? r1(31 + gained * 0.25 + R.between(-0.2, 0.2)) : null,
      thigh_cm: measure ? r1(53 + gained * 0.35 + R.between(-0.3, 0.3)) : null,
    });
  }

  // ─── Training: two blocks run through the engine ──────────────────────────────────────
  const bySlug = new Map(o.library.map((e) => [e.slug, e]));
  const mesocycles: Row[] = [], program_days: Row[] = [], program_exercises: Row[] = [], workout_sessions: Row[] = [], set_logs: Row[] = [];
  const history = new Map<string, Exposure[]>();
  const bests = new Map<string, Bests>();
  const startLoad = (e: Exercise) => (e.loadType === 'barbell' ? 30 : e.loadType === 'dumbbell' ? 10 : e.loadType === 'bodyweight' || e.loadType === 'band' ? 0 : 25);
  const blockWeeks = [Math.min(weeks, COACH.training.mesocycleWeeks), Math.max(0, weeks - COACH.training.mesocycleWeeks)];
  let blockStart = start;
  blockWeeks.forEach((bw, bi) => {
    if (bw === 0) return;
    const blockNo = bi + 1;
    const el: Eligibility = {
      equipment: availableEquipment({ trainLocation: 'gym', equipment: [] }), injuryAreas: profile.injury_areas, excluded: new Set(),
      maxDifficulty: maxDifficultyFor(experience, blockNo),
    };
    const program = generateProgram({ experience, daysPerWeek: 4, sessionMinutes: 60, library: o.library, eligibility: el });
    const mesoId = R.uuid();
    const active = bi === blockWeeks.filter((x) => x > 0).length - 1;
    mesocycles.push({
      id: mesoId, user_id: o.userId, seq: blockNo, block_no: blockNo, start_date: blockStart, weeks: program.weeks, deload_week: program.weeks,
      status: active ? 'active' : 'done', ended_reason: active ? null : 'completed', days_per_week: 4, session_minutes: 60,
      training_days: days, missing_patterns: program.missing, created_at: `${blockStart}T07:00:00Z`, ended_at: active ? null : `${addDays(blockStart, bw * 7)}T07:00:00Z`,
    });
    const dayIds = program.days.map((d, idx) => {
      const id = R.uuid();
      program_days.push({ id, user_id: o.userId, mesocycle_id: mesoId, idx, kind: d.kind });
      d.exercises.forEach((x, k) => program_exercises.push({
        id: R.uuid(), user_id: o.userId, program_day_id: id, idx: k, slug: x.slug, role: x.role, sets_by_week: x.sets,
        rep_min: x.reps[0], rep_max: x.reps[1], rest_sec: x.restSec,
      }));
      return id;
    });
    void dayIds;
    for (let w = 1; w <= bw; w++) {
      const dates = plannedDates(blockStart, w, days, program.days.length);
      program.days.forEach((day, di) => {
        const date = dates[di]!;
        if (date >= o.today) return;
        const wc = weekContext({ seq: blockNo, startDate: blockStart, weeks: program.weeks, deloadWeek: program.weeks }, experience, date);
        if (R.chance(0.08)) {
          workout_sessions.push({ id: R.uuid(), user_id: o.userId, mesocycle_id: mesoId, week: w, day_idx: di, date, status: 'skipped', deload: wc.deload, comment_status: 'none', created_at: `${date}T18:00:00Z` });
          return;
        }
        const items = day.exercises.map((x) => ({ slug: x.slug, role: x.role, sets: setsFor(x.sets, wc), reps: x.reps, restSec: x.restSec }));
        const plan = planSession([day.kind], items, { bySlug, wc, history, bests, injuryAreas: profile.injury_areas }, false);
        const sid = R.uuid();
        const t0 = Date.parse(`${date}T07:30:00Z`);
        let minute = 8;
        const logs: Row[] = [];
        plan.exercises.forEach((x, ei) => {
          const e = bySlug.get(x.slug)!;
          const load = x.load ?? startLoad(e);
          const done: { weight: number; reps: number; rir: number }[] = [];
          for (let k = 0; k < x.sets; k++) {
            const reps = Math.max(1, Math.min(x.reps[1] + (e.timed ? 5 : 0), x.targets[k]! + Math.round(R.between(-0.6, 0.8))));
            const rir = Math.max(0, Math.round(x.rir) + Math.round(R.between(-0.6, 0.4)));
            done.push({ weight: load, reps, rir });
            minute += x.role === 'main' ? 4 : 2.5;
            logs.push({
              id: R.uuid(), user_id: o.userId, session_id: sid, slug: x.slug, ex_idx: ei, set_idx: k, is_warmup: false, weight_kg: load, reps, rir,
              rep_min: x.reps[0], rep_max: x.reps[1], target_rir: x.rir, logged_at: new Date(t0 + minute * 60_000).toISOString(),
            });
          }
          history.set(x.slug, [...(history.get(x.slug) ?? []), { date, sets: done, reps: x.reps, targetRir: x.rir, deload: wc.deload }]);
        });
        const before = new Map(bests);
        for (const l of logs) bests.set(l.slug as string, addToBests(bests.get(l.slug as string) ?? emptyBests(), { weight: l.weight_kg as number, reps: l.reps as number, rir: l.rir as number }));
        const finishedAt = new Date(t0 + (minute + 3) * 60_000).toISOString();
        const summary = summarize({
          startedAt: new Date(t0).toISOString(), finishedAt, bestsBefore: before, bySlug,
          sets: logs.map((l) => ({ slug: l.slug as string, weight: l.weight_kg as number, reps: l.reps as number, rir: l.rir as number, isWarmup: false, loggedAt: l.logged_at as string })),
        });
        workout_sessions.push({
          id: sid, user_id: o.userId, mesocycle_id: mesoId, week: w, day_idx: di, date, status: 'done', deload: wc.deload, plan: { ...plan, rev: 0 }, summary,
          coach_comment: null, comment_status: 'none', started_at: new Date(t0).toISOString(), finished_at: finishedAt, created_at: new Date(t0).toISOString(),
        });
        set_logs.push(...logs);
      });
    }
    blockStart = addDays(blockStart, bw * 7);
  });

  // ─── Readiness, targets, food ─────────────────────────────────────────────────────────
  const readiness: Row[] = [];
  const t = computeTargets({ sex: 'male', weightKg: startKg, heightCm: 178, age: 29, activity: 'light', trainingDays: 4 });
  const targetId = R.uuid();
  const nutrition_targets: Row[] = [{
    id: targetId, user_id: o.userId, effective_from: start, kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat, fiber_g: t.fiber,
    water_ml: t.waterMl, bmr: t.bmr, tdee: t.tdee, factor: t.factor, surplus: t.surplus, weight_kg: startKg, reason: 'initial', created_at: `${start}T08:00:00Z`,
  }];
  const food = new Map(o.foods.map((f) => [f.id, f]));
  const meals: [string, [string, number][]][] = [
    ['نان و پنیر و تخم‌مرغ', [['bread-barbari', 110], ['feta', 40], ['egg', 100], ['walnuts', 15]]],
    ['چلو مرغ', [['rice-white-cooked', 280], ['chicken-breast-cooked', 150], ['yogurt-whole', 100]]],
    ['شیک موز', [['milk-whole', 300], ['oats', 50], ['banana', 120], ['peanut-butter', 20]]],
    ['عدسی و نان', [['lentils-cooked', 250], ['bread-sangak', 100], ['olive-oil', 10]]],
  ];
  const baseKcal = meals.reduce((a, [, items]) => a + items.reduce((b, [id, g]) => b + (food.get(id) ? macrosOf(food.get(id)!, g).kcal : 0), 0), 0);
  const food_logs: Row[] = [];
  for (let d = 0; d < weeks * 7; d++) {
    const date = addDays(start, d);
    if (R.chance(0.62)) readiness.push({ id: R.uuid(), user_id: o.userId, date, sleep_hours: r1(R.between(5.6, 8.6)), energy: Math.round(R.between(2, 5)), soreness: Math.round(R.between(1, 4)), created_at: `${date}T06:00:00Z` });
    if (!R.chance(0.8)) continue;
    const k = (t.kcal / baseKcal) * R.between(0.84, 1.07); // appetite is low: some days fall short
    meals.forEach(([label, items], mi) => {
      if (mi === 2 && R.chance(0.25)) return; // skipped the shake
      const entry = R.uuid();
      for (const [id, grams] of items) {
        const f = food.get(id);
        if (!f) continue;
        const g = Math.max(5, Math.round((grams * k) / 5) * 5);
        const m = macrosOf(f, g);
        food_logs.push({
          id: R.uuid(), user_id: o.userId, date, entry_id: entry, meal_id: null, source: mi % 2 ? 'text' : 'manual', food_id: id, grams: g,
          kcal: r1(m.kcal), protein_g: r1(m.protein), carbs_g: r1(m.carbs), fat_g: r1(m.fat), fiber_g: r1(m.fiber), estimated: f.estimated, label,
          logged_at: `${date}T${String(6 + mi * 4).padStart(2, '0')}:15:00Z`,
        });
      }
    });
  }
  return { profile, body_metrics, mesocycles, program_days, program_exercises, workout_sessions, set_logs, readiness, nutrition_targets, food_logs };
}
