// Dev only: fill a LOCAL database with ~8 weeks of realistic fake history (spec §16), so every
// chart and check-in can be reviewed before real use.
//   tsx scripts/seed-dev.ts [--user=<auth user id>] [--weeks=8] [--seed=42] [--reset] [--today=YYYY-MM-DD]
// Refuses any DATABASE_URL that isn't localhost. --reset deletes that user's existing history first.
import { EXERCISES } from '../src/data/exercises';
import { FOODS } from '../src/data/foods';
import { getPool, query, tx } from '../src/db/pool';
import { fakeData } from '../src/dev/fakeData';
import { clearUserData, insertFakeData } from '../src/dev/seedDb';
import { syncSeeds } from '../src/seeds';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const url = process.env.DATABASE_URL ?? '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`refusing to seed fake data into ${host || 'an unknown database'}: localhost only`);
  process.exit(1);
}

try {
  let user = arg('user');
  if (!user) {
    const users = await query<{ id: string }>('select id from auth.users limit 2');
    if (users.length !== 1) throw new Error('pass --user=<auth user id> (there is not exactly one user)');
    user = users[0]!.id;
  }
  const today = arg('today') ?? new Date().toISOString().slice(0, 10);
  await syncSeeds();
  const d = fakeData({ userId: user, today, library: EXERCISES, foods: FOODS, weeks: Number(arg('weeks') ?? 8), seed: Number(arg('seed') ?? 42) });
  const counts = await tx(async (c) => {
    const has = (await c.query('select 1 from public.profile where user_id = $1', [user])).rowCount;
    if (has && !process.argv.includes('--reset')) throw new Error('this user already has data; pass --reset to replace it');
    await clearUserData(c, user!);
    return insertFakeData(c, d);
  });
  console.log(`seeded ${user} up to ${today}: ${JSON.stringify(counts)}`);
} finally {
  await getPool().end();
}
