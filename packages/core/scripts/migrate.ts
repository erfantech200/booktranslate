// Local / CI: `tsx scripts/migrate.ts [--apply] [--confirm=<file>]` against $DATABASE_URL.
// Production uses the same runner through /api/admin/migrate.
import { applyMigrations, migrationStatus } from '../src/migrate';
import { syncExercises } from '../src/exerciseSeed';
import { getPool } from '../src/db/pool';

const apply = process.argv.includes('--apply');
const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);
try {
  if (apply) {
    const r = await applyMigrations({ confirm });
    if (r.stopped) { console.error(`stopped at ${r.stopped.name}: ${r.stopped.reason}`); process.exitCode = 1; }
    else if ((await migrationStatus()).applied.some((m) => m.name.endsWith('_training.sql'))) {
      const { written } = await syncExercises();
      console.log(`exercise seed: ${written.length} written`);
    }
  }
  const s = await migrationStatus();
  console.log(`applied: ${s.applied.length}, pending: ${s.pending.map((m) => m.name + (m.destructive ? ' (destructive)' : '')).join(', ') || 'none'}`);
} finally {
  await getPool().end();
}
