import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool';
import { asUser, createUser, RUN } from './helpers';

describe.skipIf(!RUN)('phase 5 tables', () => {
  it('check-ins, chat and proposals belong to their owner; one check-in per week; illustrations are readable by signed-in users', async () => {
    const a = await createUser('coach-a@example.com');
    const b = await createUser('coach-b@example.com');
    const checkin = randomUUID(), msg = randomUUID();
    await asUser(a, 'coach-a@example.com', async (q) => {
      expect((await q(`select checkin_weekday from public.profile limit 0`)).length).toBe(0); // column exists
      await q(`insert into public.checkins (id, week_end, report) values ($1, '2026-11-06', '{"weekEnd":"2026-11-06"}')`, [checkin]);
      await expect(q(`insert into public.checkins (week_end, report) values ('2026-11-06', '{}')`)).rejects.toThrow(/duplicate key/);
      await q(`insert into public.coach_messages (id, role, content) values ($1, 'assistant', 'سلام')`, [msg]);
      await q(`insert into public.adjustments (source, checkin_id, type, after, reason) values ('checkin', $1, 'calories', '{"surplus":450,"delta":150}', 'below_target')`, [checkin]);
      await q(`insert into public.adjustments (source, message_id, type, after, reason) values ('coach', $1, 'add_note', '{"text":"x"}', 'یادآوری')`, [msg]);
      await expect(q(`insert into public.adjustments (source, type, after, reason) values ('coach', 'buy_pills', '{}', 'x')`)).rejects.toThrow(/check constraint/);
      await expect(q(`insert into public.coach_messages (role, content) values ('system', 'x')`)).rejects.toThrow(/check constraint/);

      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b, role: 'authenticated' })]);
      for (const t of ['checkins', 'coach_messages', 'adjustments']) expect((await q(`select count(*)::int as n from public.${t}`))[0].n, t).toBe(0);
      await expect(q(`insert into public.coach_messages (user_id, role, content) values ($1, 'user', 'x')`, [a])).rejects.toThrow(/row-level security/);
    });
    expect((await query<{ n: number }>(`select count(*)::int as n from storage.buckets where id = 'exercise-images' and not public`))[0]!.n).toBe(1);
  });
});
