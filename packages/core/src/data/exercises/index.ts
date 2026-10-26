import type { Exercise } from '../../engine/library';
import { CORE_ARMS } from './core-arms';
import { HINGE } from './hinge';
import { LEGS } from './legs';
import { PULL } from './pull';
import { PUSH } from './push';

// The exercise library seed (spec §7): the reviewed source of truth for coaching content, synced
// into the `exercises` table by the migration runner. Edit here, never in the database.
export const EXERCISES: readonly Exercise[] = [...LEGS, ...HINGE, ...PUSH, ...PULL, ...CORE_ARMS];
