import { COACH } from '../coach.config';
import { isEligible, TRACKED_MUSCLES, type Eligibility, type Exercise, type Muscle, type Pattern } from './library';
import { isNovice, type Experience } from './weight';

// Program generator (spec §6): split by training days, exercise selection by rank and
// eligibility, weekly sets per exercise for every hard week of a mesocycle, fitted to the
// session length. Pure: the same inputs always give the same program.

const T = COACH.training;
export type Role = 'main' | 'accessory' | 'isolation';
export type TrackedMuscle = (typeof TRACKED_MUSCLES)[number];

export const DAY_KINDS = [
  'full_a', 'full_b', 'full_c', 'upper_a', 'lower_a', 'upper_b', 'lower_b', 'upper', 'lower',
  'push', 'pull', 'legs', 'push_a', 'pull_a', 'legs_a', 'push_b', 'pull_b', 'legs_b',
] as const;
export type DayKind = (typeof DAY_KINDS)[number];

interface Slot { pattern: Pattern; role: Role }
const M = (pattern: Pattern): Slot => ({ pattern, role: 'main' });
const A = (pattern: Pattern): Slot => ({ pattern, role: 'accessory' });
const I = (pattern: Pattern): Slot => ({ pattern, role: 'isolation' });

/** Day templates by training days per week. Slot order = exercise order = priority (last is cut first). */
export const TEMPLATES: Record<3 | 4 | 5 | 6, { kind: DayKind; slots: Slot[] }[]> = {
  3: [
    { kind: 'full_a', slots: [M('squat'), M('horizontal_push'), A('vertical_pull'), A('hinge'), I('lateral_delt'), I('triceps'), I('core')] },
    { kind: 'full_b', slots: [M('hinge'), M('vertical_push'), A('horizontal_pull'), A('lunge'), I('rear_delt'), I('biceps'), I('calves'), I('chest_fly')] },
    { kind: 'full_c', slots: [M('squat'), M('horizontal_pull'), A('horizontal_push'), A('vertical_pull'), I('hamstring_iso'), I('lateral_delt'), I('core'), I('calves')] },
  ],
  4: [
    { kind: 'upper_a', slots: [M('horizontal_push'), M('horizontal_pull'), A('vertical_push'), A('vertical_pull'), I('lateral_delt'), I('biceps'), I('triceps'), I('chest_fly')] },
    { kind: 'lower_a', slots: [M('squat'), A('hinge'), A('lunge'), I('hamstring_iso'), I('calves'), I('core')] },
    { kind: 'upper_b', slots: [M('vertical_pull'), M('horizontal_push'), A('horizontal_pull'), I('rear_delt'), I('lateral_delt'), I('biceps'), I('triceps')] },
    { kind: 'lower_b', slots: [M('hinge'), A('squat'), A('glute'), I('quad_iso'), I('calves'), I('core')] },
  ],
  5: [
    { kind: 'upper', slots: [M('horizontal_push'), M('horizontal_pull'), A('vertical_push'), A('vertical_pull'), I('lateral_delt'), I('biceps'), I('triceps')] },
    { kind: 'lower', slots: [M('squat'), A('hinge'), A('lunge'), I('hamstring_iso'), I('calves'), I('core')] },
    { kind: 'push', slots: [M('vertical_push'), A('horizontal_push'), I('chest_fly'), I('lateral_delt'), I('triceps')] },
    { kind: 'pull', slots: [M('vertical_pull'), A('horizontal_pull'), I('rear_delt'), I('biceps'), I('traps')] },
    { kind: 'legs', slots: [M('hinge'), A('squat'), A('glute'), I('quad_iso'), I('calves'), I('core')] },
  ],
  6: [
    { kind: 'push_a', slots: [M('horizontal_push'), A('vertical_push'), I('chest_fly'), I('lateral_delt'), I('triceps')] },
    { kind: 'pull_a', slots: [M('horizontal_pull'), A('vertical_pull'), I('rear_delt'), I('biceps')] },
    { kind: 'legs_a', slots: [M('squat'), A('hinge'), A('lunge'), I('hamstring_iso'), I('calves'), I('core')] },
    { kind: 'push_b', slots: [M('vertical_push'), A('horizontal_push'), I('lateral_delt'), I('triceps'), I('chest_fly')] },
    { kind: 'pull_b', slots: [M('vertical_pull'), A('horizontal_pull'), I('rear_delt'), I('biceps'), I('traps')] },
    { kind: 'legs_b', slots: [M('hinge'), A('squat'), A('glute'), I('quad_iso'), I('calves'), I('core')] },
  ],
};

/** When nothing eligible exists for a pattern (home equipment, injuries), try these instead. */
const FALLBACK: Partial<Record<Pattern, Pattern[]>> = {
  vertical_pull: ['horizontal_pull'], horizontal_pull: ['vertical_pull'], horizontal_push: ['vertical_push'],
  vertical_push: ['horizontal_push'], squat: ['lunge'], lunge: ['squat'], hinge: ['glute'], glute: ['hinge', 'lunge'],
  chest_fly: ['horizontal_push'], quad_iso: ['lunge', 'squat'], hamstring_iso: ['hinge', 'glute'],
  lateral_delt: ['vertical_push'], rear_delt: ['horizontal_pull'], traps: ['rear_delt'],
};

/** Every week covers these (spec §6); the program reports any it can't fill. */
export const WEEKLY_PATTERNS: readonly Pattern[] = [
  'squat', 'hinge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'lunge', 'core',
  'biceps', 'triceps', 'rear_delt', 'calves',
];

export const PUSH_PATTERNS: readonly Pattern[] = ['horizontal_push', 'vertical_push', 'chest_fly'];
export const PULL_PATTERNS: readonly Pattern[] = ['horizontal_pull', 'vertical_pull', 'rear_delt'];

export interface ProgramExercise {
  slug: string;
  role: Role;
  /** Working sets in hard weeks 1…(weeks − 1); the deload week is derived (deloadSets). */
  sets: number[];
  reps: [number, number];
  restSec: number;
}
export interface ProgramDay { kind: DayKind; exercises: ProgramExercise[] }
export interface Program {
  days: ProgramDay[];
  /** Weeks in the mesocycle, deload included. */
  weeks: number;
  /** Weekly hard sets per tracked muscle, per hard week. */
  volume: Record<TrackedMuscle, number>[];
  /** Weekly patterns no eligible exercise covers (equipment or injuries). */
  missing: Pattern[];
}

export interface ProgramInput {
  experience: Experience;
  daysPerWeek: number;
  sessionMinutes: number;
  library: readonly Exercise[];
  eligibility: Eligibility;
  /** Exercises to choose only as a last resort (stalled last mesocycle). */
  avoid?: ReadonlySet<string>;
}

export function repRangeFor(e: Exercise, role: Role, experience: Experience): [number, number] {
  // Bodyweight and band work keep their own (higher) range: the load can't be set for 6–10 reps.
  if (role === 'main' && !e.timed && e.loadType !== 'bodyweight' && e.loadType !== 'band') return [...T.mainRepRange[isNovice(experience) ? 'novice' : 'intermediate']];
  return [...e.reps];
}

export function restFor(e: Exercise, role: Role): number {
  return role === 'main' && e.compound ? T.restSec.heavy : e.restSec;
}

export const deloadSets = (hardWeekOneSets: number) => Math.max(1, Math.round(hardWeekOneSets * T.deload.setFactor));

export const minutesPerSet = (role: Role) => (role === 'main' ? T.minutesPerSet.heavy : T.minutesPerSet.other);

export function sessionMinutes(items: { role: Role; sets: number }[]): number {
  return T.warmupMinutes + items.reduce((m, x) => m + x.sets * minutesPerSet(x.role), 0);
}

/** Hard sets per muscle: primary = 1 per set, secondary = 0.5 per set (spec §6). */
export function countVolume(items: { slug: string; sets: number }[], bySlug: ReadonlyMap<string, Exercise>): Record<Muscle, number> {
  const out = {} as Record<Muscle, number>;
  for (const { slug, sets } of items) {
    const e = bySlug.get(slug);
    if (!e) continue;
    for (const m of e.primary) out[m] = (out[m] ?? 0) + sets;
    for (const m of e.secondary) out[m] = (out[m] ?? 0) + sets * 0.5;
  }
  return out;
}

const minSets = (role: Role) => (role === 'isolation' ? 1 : 2);

export function generateProgram(input: ProgramInput): Program {
  const { library, eligibility, experience } = input;
  const bySlug = new Map(library.map((e) => [e.slug, e]));
  const template = TEMPLATES[input.daysPerWeek as 3 | 4 | 5 | 6];
  if (!template) throw new Error(`no template for ${input.daysPerWeek} days`);
  const avoid = input.avoid ?? new Set<string>();
  const hardWeeks = T.mesocycleWeeks - 1;
  const budget = input.sessionMinutes;
  const target = T.startSetsPerMuscle[isNovice(experience) ? 'novice' : 'intermediate'];

  // ─── 1. Exercise selection ────────────────────────────────────────────────────────────
  const eligible = library.filter((e) => isEligible(e, eligibility));
  const candidates = (pattern: Pattern, role: Role) =>
    eligible
      .filter((e) => e.pattern === pattern && (role !== 'main' || e.compound))
      .sort((a, b) => Number(avoid.has(a.slug)) - Number(avoid.has(b.slug)) || a.rank - b.rank || a.slug.localeCompare(b.slug));
  const uses = new Map<Pattern, number>();

  type Work = { e: Exercise; role: Role; sets: number };
  // Main lifts are chosen first across the week, then accessories, then isolation, so the
  // preferred variation goes to the main slot; an exercise repeats in a week only when no
  // alternative is eligible.
  const chosen: (Work | undefined)[][] = template.map((d) => d.slots.map(() => undefined));
  const usedThisWeek = new Set<string>();
  for (const role of ['main', 'accessory', 'isolation'] as Role[]) {
    template.forEach((day, di) => day.slots.forEach((slot, si) => {
      if (slot.role !== role) return;
      let picked: Exercise | undefined;
      for (const pattern of [slot.pattern, ...(FALLBACK[slot.pattern] ?? [])]) {
        const list = candidates(pattern, slot.role).filter((e) => !chosen[di]!.some((w) => w?.e.slug === e.slug));
        if (!list.length) continue;
        const n = uses.get(pattern) ?? 0;
        uses.set(pattern, n + 1);
        picked = list.find((e) => !usedThisWeek.has(e.slug)) ?? list[n % list.length];
        break;
      }
      if (!picked) return;
      usedThisWeek.add(picked.slug);
      // A fallback for a main slot keeps the main role only if it is a compound lift.
      const r: Role = slot.role === 'main' && !picked.compound ? 'accessory' : slot.role;
      chosen[di]![si] = { e: picked, role: r, sets: T.baseSets[r] };
    }));
  }
  const days: { kind: DayKind; items: Work[] }[] = template.map((d, di) => ({
    kind: d.kind,
    items: chosen[di]!.filter((w): w is Work => !!w),
  }));

  const all = () => days.flatMap((d) => d.items);
  const minutes = (d: { items: Work[] }) => sessionMinutes(d.items);
  const volume = () => countVolume(all().map((w) => ({ slug: w.e.slug, sets: w.sets })), bySlug);
  const fits = (d: { items: Work[] }, w: Work) => minutes(d) + minutesPerSet(w.role) <= budget;
  const underCaps = (w: Work, vol: Record<Muscle, number>) =>
    w.sets < T.maxSetsPerExercise && w.e.primary.concat(w.e.secondary).every((m) => (vol[m] ?? 0) + 1 <= T.maxSetsPerMuscle);
  const dayOf = (w: Work) => days.find((d) => d.items.includes(w))!;

  // ─── 2. Fit the base sets into the session length ─────────────────────────────────────
  for (const d of days) {
    while (minutes(d) > budget) {
      const order = (['isolation', 'accessory', 'main'] as Role[]).flatMap((r) => d.items.filter((w) => w.role === r).reverse());
      const cut = order.find((w) => w.sets > minSets(w.role));
      if (cut) { cut.sets--; continue; }
      const drop = [...d.items].reverse().find((w) => w.role !== 'main') ?? d.items.at(-1);
      if (!drop) break;
      d.items.splice(d.items.indexOf(drop), 1);
    }
  }

  // ─── 3. Raise weekly volume toward the starting target where time allows ──────────────
  const addOne = (muscle: Muscle, roles: Role[]) => {
    const vol = volume();
    const options = all()
      .filter((w) => roles.includes(w.role) && w.e.primary.includes(muscle) && underCaps(w, vol) && fits(dayOf(w), w))
      .sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || a.sets - b.sets);
    if (!options[0]) return false;
    options[0].sets++;
    return true;
  };
  for (let guard = 0; guard < 200; guard++) {
    const vol = volume();
    const short = TRACKED_MUSCLES.filter((m) => (vol[m] ?? 0) < target).sort((a, b) => (vol[a] ?? 0) - (vol[b] ?? 0));
    if (!short.some((m) => addOne(m, ['isolation', 'accessory', 'main']))) break;
  }

  // ─── 4. Pulling sets ≥ pushing sets (shoulder health) ─────────────────────────────────
  const balance = () => {
    const sum = (ps: readonly Pattern[]) => all().filter((w) => ps.includes(w.e.pattern)).reduce((s, w) => s + w.sets, 0);
    for (let guard = 0; guard < 100 && sum(PULL_PATTERNS) < sum(PUSH_PATTERNS); guard++) {
      const vol = volume();
      const add = all()
        .filter((w) => PULL_PATTERNS.includes(w.e.pattern) && underCaps(w, vol) && fits(dayOf(w), w))
        .sort((a, b) => a.sets - b.sets)[0];
      if (add) { add.sets++; continue; }
      const cut = all()
        .filter((w) => PUSH_PATTERNS.includes(w.e.pattern) && w.sets > minSets(w.role))
        .sort((a, b) => Number(a.role === 'main') - Number(b.role === 'main') || b.sets - a.sets)[0];
      if (!cut) break;
      cut.sets--;
    }
  };
  balance();

  // ─── 5. Weekly ramp over the hard weeks (accessory and isolation work only) ───────────
  const base = new Map(all().map((w) => [w, w.sets]));
  const perWeek: Map<Work, number>[] = [new Map(base)];
  const volumes: Record<TrackedMuscle, number>[] = [];
  const snapshot = () => {
    const vol = volume();
    volumes.push(Object.fromEntries(TRACKED_MUSCLES.map((m) => [m, vol[m] ?? 0])) as Record<TrackedMuscle, number>);
  };
  snapshot();
  for (let week = 2; week <= hardWeeks; week++) {
    const extra = T.rampSetsByWeek[week - 1]! - T.rampSetsByWeek[week - 2]!;
    for (let r = 0; r < extra; r++) for (const m of TRACKED_MUSCLES) addOne(m, ['isolation', 'accessory']);
    balance();
    perWeek.push(new Map(all().map((w) => [w, w.sets])));
    snapshot();
  }

  const covered = new Set(all().map((w) => w.e.pattern));
  return {
    weeks: T.mesocycleWeeks,
    missing: WEEKLY_PATTERNS.filter((p) => !covered.has(p)),
    volume: volumes,
    days: days.map((d) => ({
      kind: d.kind,
      exercises: d.items.map((w) => ({
        slug: w.e.slug,
        role: w.role,
        sets: perWeek.map((m) => m.get(w)!),
        reps: repRangeFor(w.e, w.role, experience),
        restSec: restFor(w.e, w.role),
      })),
    })),
  };
}
