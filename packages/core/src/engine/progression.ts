import { COACH } from '../coach.config';
import type { Exercise } from './library';

// Double progression, load rounding, e1RM, stall and PR detection (spec §6). Loads are kg of
// external weight: 0 for a bodyweight exercise without added load.

const T = COACH.training;

export interface LoggedSet { weight: number; reps: number; rir: number | null }
/** One session's working sets of one exercise, with what was prescribed. */
export interface Exposure {
  date: string;
  sets: LoggedSet[];
  reps: [number, number];
  targetRir: number;
  /** Deload sessions are logged but never drive progression decisions. */
  deload?: boolean;
}

type LoadInfo = Pick<Exercise, 'loadType' | 'region' | 'timed'>;

/** Epley e1RM, only for 1–12 reps with a load (spec §6). */
export function e1rm(weight: number, reps: number): number | null {
  if (!(weight > 0) || reps < 1 || reps > T.e1rmMaxReps) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Smallest sensible jump for this exercise (configurable in coach.config). */
export function increment(e: LoadInfo): number {
  const i = T.increments;
  const lower = e.region === 'lower';
  switch (e.loadType) {
    case 'barbell': return lower ? i.barbellLower : i.barbellUpper;
    case 'dumbbell': return i.dumbbellStep;
    case 'machine': return lower ? i.machineLower : i.machineUpper;
    case 'cable': return i.cable;
    case 'bodyweight': return lower ? i.barbellLower : i.barbellUpper; // added load (belt/vest)
    case 'band': return 0;
  }
}

/** Round to loadable weights: barbells, machines and cables on a 2.5 kg grid, dumbbells to whole kg. */
export function roundLoad(kg: number, e: LoadInfo, mode: 'nearest' | 'down' = 'nearest'): number {
  if (kg <= 0) return 0;
  const grid = e.loadType === 'dumbbell' || e.loadType === 'band' ? 1 : 2.5;
  const f = mode === 'down' ? Math.floor : Math.round;
  const v = r2(f(kg / grid + 1e-9) * grid);
  return e.loadType === 'barbell' ? Math.max(T.emptyBarKg, v) : Math.max(grid, v);
}

/** The load an exposure was done at: the most used working weight (ties → the heavier). */
export function workingLoad(sets: readonly LoggedSet[]): number {
  const counts = new Map<number, number>();
  for (const s of sets) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1);
  let best = 0, n = -1;
  for (const [w, c] of counts) if (c > n || (c === n && w > best)) { best = w; n = c; }
  return best;
}

export const bestE1rm = (sets: readonly LoggedSet[]) =>
  sets.reduce((m, s) => Math.max(m, e1rm(s.weight, s.reps) ?? 0), 0);

/** Every working set at the top of the range, at (about) the prescribed effort. */
export function earnedIncrease(x: Exposure): boolean {
  if (!x.sets.length) return false;
  return x.sets.every((s) => s.reps >= x.reps[1] && (s.rir == null || s.rir >= x.targetRir - T.rirTolerance));
}

/** More than half of the working sets below the bottom of the range. */
export const belowRange = (x: Exposure) => x.sets.filter((s) => s.reps < x.reps[0]).length * 2 > x.sets.length;

export type Decision =
  /** First exposure: pick a load for the target reps with ~3 RIR; the app learns from the log. */
  | { kind: 'calibrate'; load: null }
  | { kind: 'increase'; load: number; from: number }
  | { kind: 'hold'; load: number }
  | { kind: 'reduce'; load: number; from: number }
  /** Top of the range without an external load to add (bodyweight, band, timed): harder variation or add reps/time. */
  | { kind: 'variation'; load: number };

/** Next session's load from past exposures (oldest first). */
export function nextLoad(e: LoadInfo, history: readonly Exposure[]): Decision {
  const xs = history.filter((x) => !x.deload && x.sets.length);
  const last = xs.at(-1);
  if (!last) return e.loadType === 'bodyweight' || e.loadType === 'band' || e.timed ? { kind: 'hold', load: 0 } : { kind: 'calibrate', load: null };
  const load = workingLoad(last.sets);

  if (earnedIncrease(last)) {
    const step = increment(e);
    if (e.timed || step === 0 || (e.loadType === 'bodyweight' && load === 0)) return { kind: 'variation', load };
    return { kind: 'increase', load: roundLoad(load + step, e), from: load };
  }

  const recent = xs.slice(-T.reduceAfterSessionsBelowRange);
  if (
    load > 0 && recent.length === T.reduceAfterSessionsBelowRange
    && recent.every((x) => belowRange(x) && Math.abs(workingLoad(x.sets) - load) < 0.01)
  ) {
    const reduced = roundLoad(load * (1 - T.reduceFraction), e, 'down');
    if (reduced < load) return { kind: 'reduce', load: reduced, from: load };
  }
  return { kind: 'hold', load };
}

/** Reps to pre-fill for working set `i` (one tap confirms the target). */
export function targetReps(d: Decision, range: [number, number], last: readonly LoggedSet[] | null, i: number): number {
  if (d.kind !== 'hold' && d.kind !== 'variation') return range[0];
  const prev = last?.[i]?.reps ?? last?.at(-1)?.reps;
  if (prev == null) return range[0];
  return Math.max(range[0], Math.min(range[1], prev + (prev < range[1] ? 1 : 0)));
}

/** No e1RM above the best before them in the last `stallExposures` exposures (spec §6). */
export function isStalled(history: readonly Exposure[]): boolean {
  const xs = history.filter((x) => !x.deload && x.sets.length);
  const n = T.stallExposures;
  if (xs.length < n + 1) return false;
  const before = Math.max(...xs.slice(0, -n).map((x) => bestE1rm(x.sets)));
  if (!(before > 0)) return false;
  return xs.slice(-n).every((x) => bestE1rm(x.sets) <= before);
}

/** Best e1RM fell in each of the last `sessions` exposures (early-deload signal). */
export function isRegressing(history: readonly Exposure[], sessions: number = T.earlyDeload.sessions): boolean {
  const xs = history.filter((x) => !x.deload && x.sets.length).map((x) => bestE1rm(x.sets));
  if (xs.length < sessions + 1 || xs.some((v) => !(v > 0))) return false;
  return xs.slice(-sessions - 1).every((v, i, a) => i === 0 || v < a[i - 1]!);
}

// ─── Personal records ─────────────────────────────────────────────────────────────────────
export type PRKind = 'load' | 'reps' | 'e1rm';
export interface Bests {
  maxWeight: number;
  maxE1rm: number;
  /** Most reps ever done at each weight (key = kg as string). */
  repsAt: Record<string, number>;
  sets: number;
}
export const emptyBests = (): Bests => ({ maxWeight: 0, maxE1rm: 0, repsAt: {}, sets: 0 });
const wk = (w: number) => String(r2(w));

/** PRs set by this working set against everything before it. Nothing counts on the first set ever. */
export function detectPRs(s: LoggedSet, b: Bests): PRKind[] {
  if (b.sets === 0 || s.reps < 1) return [];
  const out: PRKind[] = [];
  if (s.weight > b.maxWeight + 1e-9) out.push('load');
  const prev = b.repsAt[wk(s.weight)];
  if (prev != null && s.reps > prev) out.push('reps');
  const e = e1rm(s.weight, s.reps);
  if (e != null && b.maxE1rm > 0 && e > b.maxE1rm + 1e-9) out.push('e1rm');
  return out;
}

export function addToBests(b: Bests, s: LoggedSet): Bests {
  const k = wk(s.weight);
  return {
    maxWeight: Math.max(b.maxWeight, s.weight),
    maxE1rm: Math.max(b.maxE1rm, e1rm(s.weight, s.reps) ?? 0),
    repsAt: { ...b.repsAt, [k]: Math.max(b.repsAt[k] ?? 0, s.reps) },
    sets: b.sets + 1,
  };
}

export const bestsFrom = (sets: readonly LoggedSet[]) => sets.reduce(addToBests, emptyBests());
