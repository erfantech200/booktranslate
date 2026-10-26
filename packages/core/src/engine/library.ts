import { COACH } from '../coach.config';
import type { BODY_AREAS, EQUIPMENT } from './profile';

// Exercise library types and availability rules. The content itself (Persian coaching text)
// lives in src/data/exercises/*.ts, the versioned seed reviewed in git (spec §7).

export const PATTERNS = [
  'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'core',
  'chest_fly', 'quad_iso', 'hamstring_iso', 'glute', 'lateral_delt', 'rear_delt', 'biceps', 'triceps', 'calves', 'traps',
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const MUSCLES = [
  'chest', 'front_delts', 'side_delts', 'rear_delts', 'lats', 'upper_back', 'traps', 'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques', 'lower_back',
] as const;
export type Muscle = (typeof MUSCLES)[number];

/** Muscles with weekly volume targets (the rest are trained along the way). */
export const TRACKED_MUSCLES = [
  'chest', 'lats', 'upper_back', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs',
] as const satisfies readonly Muscle[];

/** Equipment from onboarding, plus gym-only items. Bodyweight is always available. */
export const EXTRA_EQUIPMENT = ['bodyweight', 'trap_bar', 'ez_bar', 'kettlebell', 'dip_station'] as const;
export type Equip = (typeof EQUIPMENT)[number] | (typeof EXTRA_EQUIPMENT)[number];
export type BodyArea = (typeof BODY_AREAS)[number];
export type LoadType = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'band';

export interface Mistake { mistake: string; fix: string }

export interface Exercise {
  slug: string;
  nameEn: string;
  nameFa: string;
  pattern: Pattern;
  primary: Muscle[];
  secondary: Muscle[];
  /** Alternative equipment sets: available if every item of ANY set is available. */
  equipment: Equip[][];
  difficulty: 1 | 2 | 3;
  unilateral: boolean;
  /** Multi-joint lift worth a heavy ramp-up and longer rest. */
  compound: boolean;
  loadType: LoadType;
  region: 'upper' | 'lower' | 'core';
  /** Lower = preferred within its pattern (program generator picks in this order). */
  rank: number;
  /** Rep range, or seconds when `timed` (holds such as the plank). */
  reps: [number, number];
  timed: boolean;
  restSec: number;
  setup: string[];
  execution: string[];
  cues: string[];
  mistakes: Mistake[];
  breathing: string;
  tempo: string;
  safety: string[];
  /** Body areas where this exercise is left out of the program if pain/injury is reported. */
  contraindications: BodyArea[];
  /** Body areas where it stays allowed but carries a caution (light load, pain-free range only). */
  cautions: BodyArea[];
  regressions: string[];
  progressions: string[];
  substitutes: string[];
}

export const videoSearchUrl = (e: Pick<Exercise, 'nameEn'>) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${e.nameEn} proper form`)}`;

export function availableEquipment(p: { trainLocation: 'gym' | 'home'; equipment: readonly string[] }): Set<Equip> {
  if (p.trainLocation === 'gym') {
    return new Set<Equip>(['barbell', 'rack', 'bench', 'dumbbells', 'cables', 'machines', 'pullup_bar', 'bands', ...EXTRA_EQUIPMENT]);
  }
  return new Set<Equip>(['bodyweight', ...(p.equipment as Equip[])]);
}

export const hasEquipment = (e: Pick<Exercise, 'equipment'>, have: Set<Equip>) =>
  e.equipment.some((set) => set.every((item) => have.has(item)));

export interface Eligibility {
  equipment: Set<Equip>;
  injuryAreas: readonly string[];
  /** Exercises the owner removed (pain ≥ 4 or by hand) until re-enabled. */
  excluded: ReadonlySet<string>;
  /** Highest allowed difficulty (novices unlock harder variations per mesocycle). */
  maxDifficulty: number;
}

export function isEligible(e: Exercise, el: Eligibility): boolean {
  return hasEquipment(e, el.equipment)
    && !e.contraindications.some((a) => el.injuryAreas.includes(a))
    && !el.excluded.has(e.slug)
    && e.difficulty <= el.maxDifficulty;
}

/** Difficulty ceiling for the n-th mesocycle (1-based). */
export function maxDifficultyFor(experience: string, mesocycleSeq: number): number {
  if (experience !== 'none' && experience !== 'lt6m') return 3;
  const steps = COACH.training.noviceMaxDifficultyByMesocycle;
  return steps[Math.min(steps.length, Math.max(1, mesocycleSeq)) - 1]!;
}

/** Substitutes for an exercise the owner can do now: listed substitutes first, then same pattern. */
export function substitutesFor(e: Exercise, library: readonly Exercise[], el: Eligibility): Exercise[] {
  const bySlug = new Map(library.map((x) => [x.slug, x]));
  const listed = [...e.substitutes, ...e.regressions].map((s) => bySlug.get(s)).filter((x): x is Exercise => !!x);
  const samePattern = library.filter((x) => x.pattern === e.pattern && x.slug !== e.slug).sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  return [...listed, ...samePattern].filter((x) => {
    if (seen.has(x.slug) || x.slug === e.slug) return false;
    seen.add(x.slug);
    // Swaps mid-workout may use any difficulty the owner can load safely, but never contraindicated or excluded ones.
    return isEligible(x, { ...el, maxDifficulty: 3 });
  });
}
