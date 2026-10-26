import { NextResponse, type NextRequest } from 'next/server';
import { applyMigrations, deleteBucket, exerciseSeedStatus, migrationStatus, serviceClient, syncExercises } from '@coach/core';

// Database migrations for production (the build container can't reach the database).
//   GET /api/admin/migrate?key=<CRON_SECRET>                      → status: applied + pending
//   GET /api/admin/migrate?key=<CRON_SECRET>&apply=1              → apply pending, stop at a destructive one
//   GET …&apply=1&confirm=<file.sql>                              → also run that destructive migration
// After applying, the exercise library seed is synced (only changed rows are written).
// GET so it can be triggered from a browser; the key keeps it private.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const p = req.nextUrl.searchParams;
  if (!secret || secret.length < 16 || p.get('key') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const log: string[] = [];
  let result = null;
  try {
    if (p.get('apply') === '1') {
      const sb = serviceClient();
      result = await applyMigrations({
        confirm: p.get('confirm') ?? undefined,
        deleteBucket: (b) => deleteBucket(sb, b),
        log: (m) => { log.push(m); console.log(JSON.stringify({ t: new Date().toISOString(), msg: m })); },
      });
    }
    const s = await migrationStatus();
    const hasLibrary = s.applied.some((m) => m.name.endsWith('_training.sql'));
    let seed = null;
    if (hasLibrary && p.get('apply') === '1' && !result?.stopped) {
      const { written } = await syncExercises();
      log.push(`exercise seed: ${written.length} written`);
    }
    if (hasLibrary) seed = await exerciseSeedStatus();
    return NextResponse.json({
      result,
      log,
      seed: seed && { total: seed.total, missing: seed.missing.length, changed: seed.changed.length },
      applied: s.applied.map((m) => ({ name: m.name, at: m.applied_at, baseline: m.baseline, changedSinceApplied: m.changed })),
      pending: s.pending.map((m) => ({ name: m.name, destructive: m.destructive, deletesBuckets: m.deleteBuckets })),
    }, { status: result?.stopped && !result.stopped.reason.startsWith('destructive') ? 500 : 200, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), log }, { status: 500 });
  }
}
