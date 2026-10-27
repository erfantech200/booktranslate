import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../../src/data/exercises';
import { FOODS } from '../../src/data/foods';
import { tx } from '../../src/db/pool';
import { fakeData } from '../../src/dev/fakeData';
import { clearUserData, insertFakeData } from '../../src/dev/seedDb';
import { asUser, createUser, RUN } from './helpers';

describe.skipIf(!RUN)('dev fake data', () => {
  it('fits the real schema, is readable by its owner only, and can be replaced', async () => {
    const u = await createUser('fake@example.com');
    const other = await createUser('fake-other@example.com');
    const d = fakeData({ userId: u, today: '2026-10-27', library: EXERCISES, foods: FOODS });
    const counts = await tx((c) => insertFakeData(c, d));
    expect(counts.set_logs).toBe(d.set_logs.length);
    await asUser(u, 'fake@example.com', async (q) => {
      expect((await q('select count(*)::int as n from public.set_logs'))[0].n).toBe(d.set_logs.length);
      const s = await q(`select summary from public.workout_sessions where status = 'done' order by date limit 1`);
      expect(s[0].summary).toMatchObject({ workingSets: expect.any(Number) });
    });
    await asUser(other, 'fake-other@example.com', async (q) => {
      expect((await q('select count(*)::int as n from public.body_metrics'))[0].n).toBe(0);
    });
    await tx(async (c) => { await clearUserData(c, u); await insertFakeData(c, d); });
  });
});
