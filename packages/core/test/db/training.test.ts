import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool';
import { EXERCISES } from '../../src/data/exercises';
import { exerciseSeedStatus, syncExercises } from '../../src/exerciseSeed';
import { asUser, createUser, RUN } from './helpers';

describe.skipIf(!RUN)('exercise library', () => {
  it('is synced from the seed and re-syncing writes nothing', async () => {
    const s = await exerciseSeedStatus();
    expect(s).toEqual({ total: EXERCISES.length, missing: [], changed: [] });
    expect((await syncExercises()).written).toEqual([]);
    const [row] = await query(`select name_fa, equipment, common_mistakes, video_search_url from public.exercises where slug = 'goblet-squat'`);
    expect(row.name_fa).toBe('اسکوات گابلت');
    expect(row.equipment).toEqual([['dumbbells'], ['kettlebell']]);
    expect(row.common_mistakes[0]).toHaveProperty('fix');
    expect(row.video_search_url).toContain('youtube.com/results');
  });

  it('rewrites only rows whose content changed', async () => {
    await query(`update public.exercises set content_hash = 'stale', name_fa = 'x' where slug = 'plank'`);
    expect((await syncExercises()).written).toEqual(['plank']);
    const [p] = await query(`select name_fa from public.exercises where slug = 'plank'`);
    expect(p.name_fa).toBe('پلانک');
  });

  it('is readable by signed-in users, writable by nobody but the service role', async () => {
    const u = await createUser('lib@example.com');
    await asUser(u, 'lib@example.com', async (q) => {
      expect((await q('select count(*)::int as n from public.exercises'))[0].n).toBe(EXERCISES.length);
      await expect(q(`update public.exercises set name_fa = 'x' where slug = 'plank'`)).rejects.toThrow(/permission denied/);
      await expect(q(`delete from public.exercises where slug = 'plank'`)).rejects.toThrow(/permission denied/);
    });
    await asUser(null, null, async (q) => {
      await expect(q('select 1 from public.exercises limit 1')).rejects.toThrow(/permission denied/);
    });
  });
});

describe.skipIf(!RUN)('training tables', () => {
  it('keep each owner to their own rows and log sets idempotently', async () => {
    const a = await createUser('train-a@example.com');
    const b = await createUser('train-b@example.com');
    const meso = randomUUID(), session = randomUUID(), set = randomUUID();
    await asUser(a, 'train-a@example.com', async (q) => {
      await q(`insert into public.mesocycles (id, seq, block_no, start_date, weeks, deload_week, days_per_week, session_minutes, training_days)
               values ($1, 1, 1, '2026-10-24', 5, 5, 3, 60, '{0,2,4}')`, [meso]);
      // Only one active block.
      await expect(q(`insert into public.mesocycles (seq, block_no, start_date, weeks, deload_week, days_per_week, session_minutes, training_days)
               values (2, 1, '2026-10-24', 5, 5, 3, 60, '{0,2,4}')`)).rejects.toThrow(/mesocycles_one_active/);
      await q(`insert into public.workout_sessions (id, mesocycle_id, week, day_idx, date, started_at) values ($1, $2, 1, 0, '2026-10-24', now())`, [session, meso]);
      const log = `insert into public.set_logs (id, session_id, slug, ex_idx, set_idx, weight_kg, reps, rir)
                   values ($1, $2, 'goblet-squat', 0, 0, 20, 10, 3) on conflict (id) do nothing`;
      await q(log, [set, session]);
      await q(log, [set, session]);
      expect((await q('select count(*)::int as n from public.set_logs'))[0].n).toBe(1);
      await q(`insert into public.readiness (date, sleep_hours, energy, soreness) values ('2026-10-24', 7, 4, 2)`);
      await q(`insert into public.pain_reports (date, slug, area, level) values ('2026-10-24', 'goblet-squat', 'knee', 2)`);
      await q(`insert into public.exercise_prefs (slug, excluded, excluded_reason) values ('goblet-squat', true, 'pain')`);
      // Writing rows for someone else is refused.
      await expect(q(`insert into public.readiness (user_id, date) values ($1, '2026-10-25')`, [b])).rejects.toThrow(/row-level security/);

      // Commit nothing (asUser rolls back); check visibility inside the same transaction as B below instead.
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b, role: 'authenticated' })]);
      for (const t of ['mesocycles', 'workout_sessions', 'set_logs', 'readiness', 'pain_reports', 'exercise_prefs']) {
        expect((await q(`select count(*)::int as n from public.${t}`))[0].n, t).toBe(0);
      }
    });
  });
});
