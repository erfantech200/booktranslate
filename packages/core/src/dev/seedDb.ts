import type pg from 'pg';
import type { FakeData } from './fakeData';

// Dev-only: write fakeData() rows for one user, or clear that user's history first.
// Bypasses RLS (direct pool); never wired into the web app.

/** Insert order respects foreign keys; clearing runs it backwards. */
export const FAKE_TABLES = [
  'profile', 'body_metrics', 'mesocycles', 'program_days', 'program_exercises', 'workout_sessions', 'set_logs',
  'readiness', 'nutrition_targets', 'food_logs',
] as const satisfies readonly (keyof FakeData)[];

const value = (v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);

export async function clearUserData(c: pg.PoolClient, userId: string) {
  // Plans and meals reference targets and are rebuilt by the app; photos keep their files, so they stay.
  for (const t of ['meal_plans', 'pain_reports', ...[...FAKE_TABLES].reverse()]) {
    await c.query(`delete from public.${t} where user_id = $1`, [userId]);
  }
}

export async function insertFakeData(c: pg.PoolClient, d: FakeData) {
  const counts: Record<string, number> = {};
  for (const t of FAKE_TABLES) {
    const rows = t === 'profile' ? [d.profile] : d[t];
    for (const r of rows) {
      const cols = Object.keys(r);
      await c.query(
        `insert into public.${t} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map((k) => value(r[k])),
      );
    }
    counts[t] = rows.length;
  }
  return counts;
}
