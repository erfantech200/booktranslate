import type { PlannedExercise, SessionPlan } from '@coach/core/shared';

/** What gym mode needs to know about each exercise (content stays on the server otherwise). */
export interface GymExercise {
  slug: string;
  nameFa: string;
  timed: boolean;
  loadType: string;
  unilateral: boolean;
  cues: string[];
  setup: string[];
  execution: string[];
}

export interface LocalSet {
  id: string;
  slug: string;
  exIdx: number;
  setIdx: number;
  isWarmup: boolean;
  weight: number;
  reps: number;
  rir: number | null;
  repMin: number | null;
  repMax: number | null;
  targetRir: number | null;
  loggedAt: string;
  synced: boolean;
}

export interface GymState {
  v: 1;
  sessionId: string;
  plan: SessionPlan;
  rev: number;
  patchDirty: boolean;
  note: string;
  sets: LocalSet[];
  deleted: string[];
  cursor: number;
  timer: { endsAt: number; total: number; exIdx: number } | null;
}

export interface SwapResult { planned: PlannedExercise; info: GymExercise }
