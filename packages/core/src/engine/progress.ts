import { COACH } from '../coach.config';
import { TRACKED_MUSCLES, type Exercise, type Muscle } from './library';
import { e1rm } from './progression';
import { weekday } from './schedule';
import { addDays, movingAverage, toDay, type TrendPoint, type WeighIn } from './weight';

// Progress analytics (spec §10): measurements, gain-quality proxies, strength and volume,
// adherence, streaks and the journey timeline. Pure; dates are ISO calendar days.

const P = COACH.progress;

export const MEASURES = ['waist', 'chest', 'arm', 'thigh'] as const;
export type Measure = (typeof MEASURES)[number];
export interface Measurement { date: string; waist: number | null; chest: number | null; arm: number | null; thigh: number | null }

/** Calendar week start (Saturday) of a date, the week used across the app. */
export const weekOfDate = (date: string) => addDays(date, -weekday(date));

const daysBetween = (a: string, b: string) => toDay(b) - toDay(a);

// ─── Due dates ────────────────────────────────────────────────────────────────────────────
export function measurementStatus(ms: readonly Measurement[], today: string) {
  const last = [...ms].filter((m) => MEASURES.some((k) => m[k] != null)).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const next = last ? addDays(last.date, P.measurementEveryDays) : today;
  return { last: last?.date ?? null, next, due: daysBetween(next, today) >= 0 };
}

export function photoStatus(dates: readonly string[], today: string) {
  const last = [...dates].sort().at(-1) ?? null;
  const age = last ? daysBetween(last, today) : Infinity;
  return { last, due: age >= P.photoDueDays, overdue: age >= P.photoOverdueDays, next: last ? addDays(last, P.photoDueDays) : today };
}

// ─── Strength ─────────────────────────────────────────────────────────────────────────────
export interface WorkSet { date: string; slug: string; weight: number; reps: number }

/** Best e1RM per session date for one exercise (sets of ≤ 12 reps with load). */
export function e1rmSeries(sets: readonly WorkSet[], slug: string): TrendPoint[] {
  const best = new Map<string, number>();
  for (const s of sets) {
    if (s.slug !== slug) continue;
    const v = e1rm(s.weight, s.reps);
    if (v != null && v > (best.get(s.date) ?? 0)) best.set(s.date, v);
  }
  return [...best].sort((a, b) => a[0].localeCompare(b[0])).map(([date, kg]) => ({ date, kg: Math.round(kg * 10) / 10 }));
}

/** Mean relative change of best e1RM between the start and end of a window, over the lifts trained in both halves. */
export function strengthChangePct(sets: readonly WorkSet[], slugs: readonly string[], from: string, to: string): number | null {
  const mid = addDays(from, Math.floor(daysBetween(from, to) / 2));
  const changes: number[] = [];
  for (const slug of slugs) {
    const s = e1rmSeries(sets, slug).filter((p) => p.date >= from && p.date <= to);
    const a = s.filter((p) => p.date < mid).map((p) => p.kg), b = s.filter((p) => p.date >= mid).map((p) => p.kg);
    if (!a.length || !b.length) continue;
    changes.push(Math.max(...b) / Math.max(...a) - 1);
  }
  return changes.length ? (changes.reduce((x, y) => x + y, 0) / changes.length) * 100 : null;
}

/** Working-set volume per calendar week: tonnage (kg × reps, loaded sets) and hard sets per muscle. */
export function weeklyVolume(sets: readonly WorkSet[], bySlug: ReadonlyMap<string, Exercise>) {
  const weeks = new Map<string, { week: string; tonnage: number; sets: number; muscles: Partial<Record<Muscle, number>> }>();
  for (const s of sets) {
    const w = weekOfDate(s.date);
    const row = weeks.get(w) ?? { week: w, tonnage: 0, sets: 0, muscles: {} };
    const e = bySlug.get(s.slug);
    if (!e?.timed) row.tonnage += s.weight * s.reps;
    row.sets += 1;
    for (const m of e?.primary ?? []) row.muscles[m] = (row.muscles[m] ?? 0) + 1;
    for (const m of e?.secondary ?? []) row.muscles[m] = (row.muscles[m] ?? 0) + 0.5;
    weeks.set(w, row);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Weekly sets per tracked muscle against the range the program aims for: from the sets the block
 * planned for that week (when known; the config starting volume otherwise) up to the weekly cap.
 * Half a set of slack absorbs secondary-muscle rounding.
 */
export function muscleVolume(week: Partial<Record<Muscle, number>> | undefined, novice: boolean, planned?: Partial<Record<Muscle, number>>) {
  const base = COACH.training.startSetsPerMuscle[novice ? 'novice' : 'intermediate'];
  const hi = COACH.training.maxSetsPerMuscle;
  return TRACKED_MUSCLES.map((m) => {
    const sets = week?.[m] ?? 0;
    const lo = planned ? Math.min(hi, planned[m] ?? 0) : base;
    return { muscle: m, sets, lo, hi, status: sets < lo - 0.5 ? 'low' as const : sets > hi ? 'high' as const : 'ok' as const };
  });
}

// ─── Gain quality (muscle-vs-fat proxy) ───────────────────────────────────────────────────
export type Quality = 'good' | 'ok' | 'watch' | 'insufficient';
export interface GainQuality {
  level: Quality;
  from: string;
  to: string;
  weightChangeKg: number | null;
  waistChangeCm: number | null;
  waistPerKg: number | null;
  strengthChangePct: number | null;
}

/**
 * A simple, honest proxy for "is the weight mostly muscle?" over the last 4 weeks: how much the
 * waist grew per kg gained, and whether strength kept rising. Not a body-composition measurement.
 */
export function gainQuality(o: {
  weighIns: readonly WeighIn[];
  measurements: readonly Measurement[];
  sets: readonly WorkSet[];
  mainLifts: readonly string[];
  today: string;
}): GainQuality {
  const to = o.today, from = addDays(to, -P.qualityWindowDays);
  const trend = movingAverage([...o.weighIns]);
  const end = trend.filter((p) => p.date <= to).at(-1);
  const start = trend.filter((p) => p.date <= from).at(-1) ?? trend.find((p) => p.date >= from);
  const weightChangeKg = end && start && daysBetween(start.date, end.date) >= 21 ? Math.round((end.kg - start.kg) * 100) / 100 : null;

  const waists = o.measurements.filter((m) => m.waist != null).sort((a, b) => a.date.localeCompare(b.date));
  const wEnd = waists.filter((m) => m.date <= to).at(-1);
  const wStart = waists.filter((m) => m.date <= addDays(from, 7)).at(-1);
  const waistChangeCm = wEnd && wStart && daysBetween(wStart.date, wEnd.date) >= 14 ? Math.round((wEnd.waist! - wStart.waist!) * 10) / 10 : null;

  const strength = strengthChangePct(o.sets, o.mainLifts, from, to);
  const strengthPct = strength == null ? null : Math.round(strength * 10) / 10;
  const base = { from, to, weightChangeKg, waistChangeCm, strengthChangePct: strengthPct };
  if (weightChangeKg == null || waistChangeCm == null || weightChangeKg < P.qualityMinWeightChangeKg) {
    return { ...base, level: 'insufficient', waistPerKg: null };
  }
  const perKg = Math.round((waistChangeCm / weightChangeKg) * 100) / 100;
  const stronger = strengthPct == null || strengthPct >= P.strengthFlatPct;
  const level: Quality = perKg > P.waistPerKgWatch || (!stronger && perKg > P.waistPerKgGood)
    ? 'watch'
    : perKg <= P.waistPerKgGood && stronger ? 'good' : 'ok';
  return { ...base, level, waistPerKg: perKg };
}

// ─── Adherence and streaks ────────────────────────────────────────────────────────────────
export interface FoodDay { date: string; kcal: number; protein: number }

export function nutritionAdherence(days: readonly FoodDay[], targetFor: (date: string) => { kcal: number; protein: number } | null) {
  let logged = 0, protein = 0, kcal = 0;
  for (const d of days) {
    const t = targetFor(d.date);
    if (!t || d.kcal <= 0) continue;
    logged++;
    if (d.protein >= (t.protein * P.proteinHitPct) / 100) protein++;
    if (Math.abs(d.kcal - t.kcal) <= (t.kcal * P.kcalHitTolerancePct) / 100) kcal++;
  }
  return { logged, proteinHit: protein, kcalHit: kcal };
}

/** Workouts done vs planned per calendar week (planned = training days per week, skipped count as missed). */
export function workoutAdherence(done: readonly string[], weeks: readonly string[], perWeek: number) {
  return weeks.map((w) => ({ week: w, planned: perWeek, done: done.filter((d) => weekOfDate(d) === w).length }));
}

/** Consecutive days with an entry, ending today (or yesterday, when today isn't logged yet). */
export function streak(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// ─── Journey timeline ─────────────────────────────────────────────────────────────────────
export type TimelineEvent =
  | { date: string; kind: 'start'; weightKg: number }
  | { date: string; kind: 'block'; blockNo: number; end: string | null }
  | { date: string; kind: 'prs'; items: { slug: string; weight: number; reps: number }[] }
  | { date: string; kind: 'photos'; angles: string[] }
  | { date: string; kind: 'weight'; kg: number; gained: number }
  | { date: string; kind: 'workouts'; count: number }
  | { date: string; kind: 'measure'; waist: number | null };

export function timeline(o: {
  startDate: string;
  startWeightKg: number;
  weighIns: readonly WeighIn[];
  blocks: readonly { blockNo: number; start: string; end: string | null }[];
  prs: readonly { date: string; slug: string; weight: number; reps: number }[];
  photos: readonly { date: string; angle: string }[];
  workouts: readonly string[];
  measurements: readonly Measurement[];
}): TimelineEvent[] {
  const ev: TimelineEvent[] = [{ date: o.startDate, kind: 'start', weightKg: o.startWeightKg }];
  for (const b of o.blocks) ev.push({ date: b.start, kind: 'block', blockNo: b.blockNo, end: b.end });
  // Beginners set records nearly every session, so records are gathered per calendar week: one
  // entry (dated at the week's last record) listing each exercise once, with its heaviest set.
  const weeks = new Map<string, { date: string; items: Map<string, { slug: string; weight: number; reps: number }> }>();
  for (const p of o.prs) {
    const w = weeks.get(weekOfDate(p.date)) ?? { date: p.date, items: new Map() };
    if (p.date > w.date) w.date = p.date;
    const prev = w.items.get(p.slug);
    if (!prev || p.weight > prev.weight || (p.weight === prev.weight && p.reps > prev.reps)) w.items.set(p.slug, { slug: p.slug, weight: p.weight, reps: p.reps });
    weeks.set(weekOfDate(p.date), w);
  }
  for (const w of weeks.values()) ev.push({ date: w.date, kind: 'prs', items: [...w.items.values()] });
  const byDay = new Map<string, string[]>();
  for (const p of o.photos) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p.angle]);
  for (const [date, angles] of byDay) ev.push({ date, kind: 'photos', angles });
  let next = P.weightMilestoneKg;
  for (const p of movingAverage([...o.weighIns])) {
    while (p.kg - o.startWeightKg >= next) {
      ev.push({ date: p.date, kind: 'weight', kg: Math.round(p.kg * 10) / 10, gained: next });
      next += P.weightMilestoneKg;
    }
  }
  const sorted = [...o.workouts].sort();
  for (const n of P.workoutMilestones) if (sorted[n - 1]) ev.push({ date: sorted[n - 1]!, kind: 'workouts', count: n });
  for (const m of o.measurements) if (m.waist != null) ev.push({ date: m.date, kind: 'measure', waist: m.waist });
  // Newest first; within a day the start of something sits below what happened on it.
  const order: TimelineEvent['kind'][] = ['start', 'block', 'workouts', 'weight', 'measure', 'photos', 'prs'];
  return ev.sort((a, b) => b.date.localeCompare(a.date) || order.indexOf(b.kind) - order.indexOf(a.kind));
}
