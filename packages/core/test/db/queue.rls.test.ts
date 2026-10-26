import { describe, expect, it } from 'vitest';
import { query, one } from '../../src/db/pool';
import { claimJobs, completeJob, enqueue, failJob, pauseJob, resumePausedJobs } from '../../src/queue';
import { dbCallHooks, monthToDateSpend } from '../../src/usage';
import { BudgetExceededError } from '../../src/openai/structured';
import { resetEnvCache } from '../../src/config';
import { applyMigrations, migrationStatus } from '../../src/migrate';
import { asUser, createUser, RUN } from './helpers';
import { hashIp, loginBlockedMinutes, recordLoginAttempt } from '../../src/loginLimit';

describe.skipIf(!RUN)('migrations', () => {
  it('leave no translator tables, nothing pending, and re-running is a no-op', async () => {
    const tables = (await query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.t);
    expect(tables).toEqual([
      'ai_usage', 'body_metrics', 'exercise_prefs', 'exercises', 'jobs', 'login_attempts', 'mesocycles', 'pain_reports', 'profile',
      'program_days', 'program_exercises', 'progress_photos', 'readiness', 'schema_migrations', 'set_logs', 'workout_sessions',
    ]);
    expect((await migrationStatus()).pending).toEqual([]);
    expect(await applyMigrations()).toEqual({ applied: [] });
  });
});

describe.skipIf(!RUN)('queue', () => {
  it('dedupes live jobs and never hands the same job to two workers', async () => {
    const u = await createUser('queue@example.com');
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      enqueue({ userId: u, type: 'test_job', payload: { n: i }, dedupeKey: `q-test-${i % 3}` })));
    expect(ids.filter(Boolean)).toHaveLength(3);

    const [a, b] = await Promise.all([claimJobs('w1', 2, 60), claimJobs('w2', 2, 60)]);
    const claimed = [...a, ...b].filter((j) => j.dedupe_key?.startsWith('q-test-'));
    expect(new Set(claimed.map((j) => j.id)).size).toBe(claimed.length);
    expect(claimed.length).toBe(3);
    for (const j of claimed) await completeJob(j.id);
    // After completion the dedupe key is free again.
    expect(await enqueue({ userId: u, type: 'test_job', payload: {}, dedupeKey: 'q-test-0' })).not.toBeNull();
    await query(`delete from public.jobs where dedupe_key like 'q-test-%'`);
  });

  it('backs off on failure, fails after max attempts, and re-claims expired leases', async () => {
    const u = await createUser('queue2@example.com');
    const id = (await enqueue({ userId: u, type: 'test_job', payload: {}, maxAttempts: 2, dedupeKey: 'q-retry' }))!;
    let [job] = (await claimJobs('w', 50, 60)).filter((j) => j.id === id);
    expect(await failJob(job!, 'boom')).toBe('retry');
    const row = await one('select status, run_after > now() as later, last_error from public.jobs where id = $1', [id]);
    expect(row).toMatchObject({ status: 'queued', later: true, last_error: 'boom' });

    await query(`update public.jobs set run_after = now() where id = $1`, [id]);
    [job] = (await claimJobs('w', 50, 1)).filter((j) => j.id === id);
    expect(job!.attempts).toBe(2);
    // Simulate a crashed worker: lease expires → claimable again.
    await query(`update public.jobs set locked_until = now() - interval '1 second' where id = $1`, [id]);
    const [again] = (await claimJobs('w-new', 50, 60)).filter((j) => j.id === id);
    expect(again?.locked_by).toBe('w-new');
    expect(await failJob(again!, 'boom again')).toBe('failed');
    expect((await one('select status from public.jobs where id = $1', [id])).status).toBe('failed');
  });

  it('enforces the monthly AI budget except for essential calls, and pauses/resumes jobs', async () => {
    const u = await createUser('budget@example.com');
    process.env.OPENAI_MONTHLY_BUDGET_USD = '0.5';
    resetEnvCache();
    try {
      await dbCallHooks.logUsage({ userId: u, feature: 'test', model: 'gpt-6-luna', inputTokens: 10, cachedTokens: 0,
        cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0, costUsd: 0.6, ok: true, requestId: null });
      expect(await monthToDateSpend(u)).toBeCloseTo(0.6, 6);
      await expect(dbCallHooks.checkBudget({ userId: u, feature: 'meal_plan' })).rejects.toBeInstanceOf(BudgetExceededError);
      await expect(dbCallHooks.checkBudget({ userId: u, feature: 'food_log', essential: true })).resolves.toBeUndefined();
    } finally {
      delete process.env.OPENAI_MONTHLY_BUDGET_USD;
      resetEnvCache();
    }
    const id = (await enqueue({ userId: u, type: 'test_job', payload: {} }))!;
    await pauseJob(id, 'budget');
    expect((await one('select status from public.jobs where id = $1', [id])).status).toBe('paused');
    expect(await resumePausedJobs(u)).toBe(1);
    await query('delete from public.jobs where id = $1', [id]);
  });
});

describe.skipIf(!RUN)('RLS', () => {
  it('isolates users and keeps queue state and usage server-only', async () => {
    const a = await createUser('alice@example.com');
    const b = await createUser('bob@example.com');
    const jobA = (await enqueue({ userId: a, type: 'test_job', payload: {} }))!;
    await query(`insert into public.ai_usage (user_id, feature, model, cost_usd) values ($1, 'test', 'gpt-6-luna', 0.01)`, [a]);

    await asUser(a, 'alice@example.com', async (q) => {
      expect((await q('select id from public.jobs')).map((r) => r.id)).toEqual([jobA]);
      expect(await q('select feature from public.ai_usage')).toEqual([{ feature: 'test' }]);
      await q(`insert into public.jobs (user_id, type, payload) values ($1, 'test_job', '{}')`, [a]);
      await expect(q(`insert into public.jobs (user_id, type, payload, status) values ($1, 'test_job', '{}', 'done')`, [a])).rejects.toThrow(/row-level security/);
      await expect(q(`insert into public.jobs (user_id, type, payload) values ($1, 'test_job', '{}')`, [b])).rejects.toThrow(/row-level security/);
      await expect(q(`update public.jobs set status = 'done' where id = $1`, [jobA])).rejects.toThrow(/permission denied/);
      await expect(q(`insert into public.ai_usage (user_id, feature, model) values ($1, 'x', 'y')`, [a])).rejects.toThrow(/permission denied/);
      await expect(q('select * from public.schema_migrations')).rejects.toThrow(/permission denied/);
    });
    await asUser(b, 'bob@example.com', async (q) => {
      expect(await q('select id from public.jobs')).toEqual([]);
      expect(await q('select id from public.ai_usage')).toEqual([]);
    });
    await asUser(null, null, async (q) => {
      await expect(q('select id from public.jobs')).rejects.toThrow(/permission denied/);
    });
    await query('delete from public.jobs where user_id = $1', [a]);
  });
});

describe.skipIf(!RUN)('profile and metrics', () => {
  it('keeps each user to their own rows; login attempts are server-only', async () => {
    const a = await createUser('owner@example.com');
    const b = await createUser('other@example.com');
    await asUser(a, 'owner@example.com', async (q) => {
      await q(`insert into public.profile (user_id, sex, height_cm) values ($1, 'male', 178)`, [a]);
      await q(`insert into public.body_metrics (user_id, date, weight_kg) values ($1, '2026-11-01', 70.2)`, [a]);
      // One row per day: a second weigh-in the same day is an update (upsert), not a new row.
      await q(`insert into public.body_metrics (user_id, date, weight_kg) values ($1, '2026-11-01', 70.6)
               on conflict (user_id, date) do update set weight_kg = excluded.weight_kg`, [a]);
      expect(await q('select weight_kg::float as w from public.body_metrics')).toEqual([{ w: 70.6 }]);
      await expect(q(`insert into public.body_metrics (user_id, date, weight_kg) values ($1, '2026-11-02', 70)`, [b])).rejects.toThrow(/row-level security/);
      await expect(q(`insert into public.body_metrics (user_id, date, weight_kg) values ($1, '2026-11-03', 999)`, [a])).rejects.toThrow(/check constraint/);
      await expect(q('select * from public.login_attempts')).rejects.toThrow(/permission denied/);
      // Commit these rows for the next block (asUser rolls back): copy them as the service role.
    });
    await query(`insert into public.profile (user_id, sex) values ($1, 'male')`, [a]);
    await asUser(b, 'other@example.com', async (q) => {
      expect(await q('select * from public.profile')).toEqual([]);
      expect(await q(`update public.profile set sex = 'female' where user_id = $1 returning user_id`, [a])).toEqual([]);
    });
    await query('delete from public.profile where user_id = $1', [a]);
  });

  it('blocks an IP after 5 failures in 15 minutes and clears on success', async () => {
    const ip = hashIp('203.0.113.7', 'test-secret');
    expect(ip).not.toContain('203');
    for (let i = 0; i < 4; i++) await recordLoginAttempt(ip, false);
    expect(await loginBlockedMinutes(ip)).toBe(0);
    await recordLoginAttempt(ip, false);
    const wait = await loginBlockedMinutes(ip);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15);
    // Failures older than the window don't count.
    await query(`update public.login_attempts set created_at = now() - interval '16 minutes' where ip_hash = $1`, [ip]);
    expect(await loginBlockedMinutes(ip)).toBe(0);
    await recordLoginAttempt(ip, true);
    expect((await one('select count(*)::int as n from public.login_attempts where ip_hash = $1 and not ok', [ip])).n).toBe(0);
  });
});
