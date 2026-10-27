import { exerciseSeedStatus, syncExercises } from './exerciseSeed';
import { foodSeedStatus, syncFoods } from './foodSeed';
import { migrationStatus } from './migrate';

// Reference-data seeds kept in git and synced after migrations (CLI, /api/admin/migrate). Each
// seed only runs once the migration that creates its table has been applied.
const SEEDS = [
  { name: 'exercises', after: '_training.sql', sync: syncExercises, status: exerciseSeedStatus },
  { name: 'foods', after: '_nutrition.sql', sync: syncFoods, status: foodSeedStatus },
] as const;

async function ready() {
  const applied = (await migrationStatus()).applied.map((m) => m.name);
  return SEEDS.filter((s) => applied.some((n) => n.endsWith(s.after)));
}

export async function syncSeeds(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of await ready()) out[s.name] = (await s.sync()).written.length;
  return out;
}

export async function seedStatus(): Promise<{ name: string; total: number; missing: number; changed: number }[]> {
  const out = [];
  for (const s of await ready()) {
    const r = await s.status();
    out.push({ name: s.name, total: r.total, missing: r.missing.length, changed: r.changed.length });
  }
  return out;
}
