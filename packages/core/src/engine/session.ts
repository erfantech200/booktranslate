import { COACH } from '../coach.config';
import type { Exercise, Muscle } from './library';
import { deloadSets, sessionMinutes, type DayKind, type Role } from './program';
import {
  addToBests, detectPRs, emptyBests, increment, nextLoad, roundLoad, targetReps,
  type Bests, type Decision, type Exposure, type LoggedSet, type PRKind,
} from './progression';
import { weekOf } from './schedule';
import { isNovice, type Experience } from './weight';

// One session's prescription (sets × reps × load × RIR, warm-ups, last time) and its summary.

const T = COACH.training;

export interface MesoInfo { seq: number; startDate: string; weeks: number; deloadWeek: number }
export interface WeekContext { week: number; deload: boolean; technique: boolean }

export function weekContext(m: MesoInfo, experience: Experience, date: string): WeekContext {
  const week = Math.min(m.weeks, Math.max(1, weekOf(m.startDate, date)));
  const deload = week >= m.deloadWeek;
  const technique = !deload && m.seq === 1 && isNovice(experience) && week <= T.techniqueWeeks;
  return { week, deload, technique };
}

/** RIR wave (spec §6): 3 → 2 → 1–2 → 1 (isolation may reach 0); technique weeks 3–4; deload 4. */
export function targetRir(role: Role, wc: WeekContext): number {
  if (wc.deload) return T.deload.rir;
  if (wc.technique) return T.techniqueRir;
  const wave = T.rirByWeek;
  const i = Math.min(wc.week, wave.length) - 1;
  if (role === 'isolation' && i === wave.length - 1) return T.isolationRirLastWeek;
  return wave[i]!;
}

/**
 * Working sets this week. `holdRamp`: recovery isn't good, so stay at last week's volume.
 * `lowReadiness`: drop the last set today (never below one).
 */
export function setsFor(sets: readonly number[], wc: WeekContext, o: { holdRamp?: boolean; lowReadiness?: boolean } = {}): number {
  let n: number;
  if (wc.deload) n = deloadSets(sets[0] ?? 1);
  else {
    const i = Math.min(wc.week, sets.length) - 1 - (o.holdRamp ? 1 : 0);
    n = sets[Math.max(0, i)] ?? 1;
  }
  return o.lowReadiness ? Math.max(1, n - 1) : n;
}

export interface Warmup { fraction: number; reps: number; weight: number | null }

/** Ramp-up sets for compound lifts (spec §6): the first compound gets the long ramp. */
export function warmups(e: Exercise, role: Role, load: number | null, firstCompound: boolean): Warmup[] {
  if (!e.compound || role === 'isolation' || e.timed || e.loadType === 'bodyweight' || e.loadType === 'band') return [];
  const out: Warmup[] = [];
  for (const [fraction, reps] of firstCompound ? T.warmupFirst : T.warmupLater) {
    const weight = load ? roundLoad(load * fraction, e) : null;
    if (weight != null && (weight >= load! || out.some((w) => w.weight === weight))) continue;
    out.push({ fraction, reps, weight });
  }
  return out;
}

export interface ProgramItem { slug: string; role: Role; sets: number; reps: [number, number]; restSec: number }

export interface PlannedExercise extends ProgramItem {
  rir: number;
  timed: boolean;
  load: number | null;
  decision: Decision['kind'];
  /** Previous load when the decision changed it. */
  from: number | null;
  increment: number;
  warmups: Warmup[];
  /** Reps (or seconds) to pre-fill per working set. */
  targets: number[];
  last: { date: string; sets: LoggedSet[] } | null;
  bests: Bests;
  /** Allowed with a reported injury area: light load, pain-free range only. */
  caution: boolean;
  skipped?: boolean;
  swappedFrom?: string;
}

export interface SessionPlan {
  kinds: DayKind[];
  week: number;
  deload: boolean;
  technique: boolean;
  lowReadiness: boolean;
  estMinutes: number;
  exercises: PlannedExercise[];
}

export interface PlanContext {
  bySlug: ReadonlyMap<string, Exercise>;
  wc: WeekContext;
  history: ReadonlyMap<string, readonly Exposure[]>;
  bests: ReadonlyMap<string, Bests>;
  injuryAreas: readonly string[];
}

export function planExercise(item: ProgramItem, ctx: PlanContext, firstCompound: boolean): PlannedExercise {
  const e = ctx.bySlug.get(item.slug);
  if (!e) throw new Error(`unknown exercise ${item.slug}`);
  const history = ctx.history.get(item.slug) ?? [];
  let d = nextLoad(e, history);
  // Deload: same loads, nothing new (spec §6).
  if (ctx.wc.deload && (d.kind === 'increase' || d.kind === 'reduce')) d = { kind: 'hold', load: d.from };
  const lastX = [...history].reverse().find((x) => x.sets.length) ?? null;
  const last = lastX ? { date: lastX.date, sets: lastX.sets } : null;
  return {
    ...item,
    rir: targetRir(item.role, ctx.wc),
    timed: e.timed,
    load: d.load,
    decision: d.kind,
    from: 'from' in d ? d.from : null,
    increment: increment(e),
    warmups: warmups(e, item.role, d.load, firstCompound),
    targets: Array.from({ length: item.sets }, (_, i) => targetReps(d, item.reps, last?.sets ?? null, i)),
    last,
    bests: ctx.bests.get(item.slug) ?? emptyBests(),
    caution: e.cautions.some((a) => ctx.injuryAreas.includes(a)),
  };
}

export function planSession(kinds: DayKind[], items: ProgramItem[], ctx: PlanContext, lowReadiness: boolean): SessionPlan {
  let seenCompound = false;
  const exercises = items.map((it) => {
    const e = ctx.bySlug.get(it.slug);
    const first = !!e?.compound && !seenCompound && it.role !== 'isolation';
    if (first) seenCompound = true;
    return planExercise(it, ctx, first);
  });
  return {
    kinds, ...ctx.wc, lowReadiness, exercises,
    estMinutes: Math.round(sessionMinutes(exercises)),
  };
}

// ─── Summary (finish screen) ──────────────────────────────────────────────────────────────
export interface SetRecord extends LoggedSet { slug: string; isWarmup: boolean; loggedAt: string }
export interface SessionSummary {
  minutes: number;
  volumeKg: number;
  workingSets: number;
  exercises: number;
  setsPerMuscle: Partial<Record<Muscle, number>>;
  prs: { slug: string; kinds: PRKind[]; weight: number; reps: number }[];
}

export function summarize(o: {
  startedAt: string;
  finishedAt: string;
  sets: readonly SetRecord[];
  bestsBefore: ReadonlyMap<string, Bests>;
  bySlug: ReadonlyMap<string, Exercise>;
}): SessionSummary {
  const work = o.sets.filter((s) => !s.isWarmup).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const bests = new Map(o.bestsBefore);
  const prs = new Map<string, SessionSummary['prs'][number]>();
  const perMuscle: Partial<Record<Muscle, number>> = {};
  for (const s of work) {
    const b = bests.get(s.slug) ?? emptyBests();
    const kinds = detectPRs(s, b);
    if (kinds.length) {
      const prev = prs.get(s.slug);
      prs.set(s.slug, {
        slug: s.slug,
        kinds: [...new Set([...(prev?.kinds ?? []), ...kinds])],
        weight: s.weight,
        reps: s.reps,
      });
    }
    bests.set(s.slug, addToBests(b, s));
    const e = o.bySlug.get(s.slug);
    for (const m of e?.primary ?? []) perMuscle[m] = (perMuscle[m] ?? 0) + 1;
    for (const m of e?.secondary ?? []) perMuscle[m] = (perMuscle[m] ?? 0) + 0.5;
  }
  const ms = Date.parse(o.finishedAt) - Date.parse(o.startedAt);
  return {
    minutes: Math.max(0, Math.round(ms / 60_000)),
    volumeKg: Math.round(work.reduce((v, s) => v + (o.bySlug.get(s.slug)?.timed ? 0 : s.weight * s.reps), 0)),
    workingSets: work.length,
    exercises: new Set(work.map((s) => s.slug)).size,
    setsPerMuscle: perMuscle,
    prs: [...prs.values()],
  };
}
