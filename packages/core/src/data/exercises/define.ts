import type { Exercise } from '../../engine/library';

// Seed helper: fills the optional list fields so each entry only states what matters.
type Optional = 'unilateral' | 'timed' | 'contraindications' | 'cautions' | 'regressions' | 'progressions' | 'substitutes';
export type ExerciseDef = Omit<Exercise, Optional> & Partial<Pick<Exercise, Optional>>;

export const ex = (d: ExerciseDef): Exercise => ({
  unilateral: false,
  timed: false,
  contraindications: [],
  cautions: [],
  regressions: [],
  progressions: [],
  substitutes: [],
  ...d,
});
