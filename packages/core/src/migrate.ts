import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { maybeOne, query, tx } from './db/pool';

// Applies supabase/migrations/*.sql in filename order and records each in schema_migrations.
//
// Header directives (comment lines at the top of a migration):
//   -- @destructive              refuses to run unless `confirm` equals the file name
//   -- @delete-buckets: a, b     deletes these storage buckets (and their files) through the
//                                Storage API right before the SQL runs; Supabase blocks direct
//                                SQL deletes on storage tables.
// Migrations applied by hand before this runner existed are recorded as a baseline when the
// tracking table is first created on a database that already has them.

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
  destructive: boolean;
  deleteBuckets: string[];
}

/** Hand-applied before the runner existed (2026-10-25). */
const BASELINE = ['20261025000000_init.sql', '20261025000100_ui_helpers.sql'];
const BASELINE_PROBE = 'app_allowlist';

// Resolved from a working directory the bundler cannot evaluate (see next.config.ts tracing):
// apps/web (Next) and packages/core (tests) both sit two levels below the repo root.
const runtimeCwd = (): string => Reflect.apply(process.cwd, process, []) as string;
export function migrationsDir(): string {
  const candidates = [process.env.MIGRATIONS_DIR, resolve(runtimeCwd(), '../../supabase/migrations'), resolve(runtimeCwd(), 'supabase/migrations')];
  const dir = candidates.find((d) => d && existsSync(d));
  if (!dir) throw new Error('supabase/migrations not found');
  return dir;
}

export function loadMigrations(dir = migrationsDir()): Migration[] {
  return readdirSync(dir).filter((f) => /^\d{14}_[\w-]+\.sql$/.test(f)).sort().map((name) => {
    const sql = readFileSync(join(dir, name), 'utf8');
    const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
    const buckets = /^--\s*@delete-buckets:\s*(.+)$/m.exec(header)?.[1];
    return {
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
      destructive: /^--\s*@destructive\b/m.test(header),
      deleteBuckets: buckets ? buckets.split(',').map((b) => b.trim()).filter(Boolean) : [],
    };
  });
}

async function ensureTable(): Promise<void> {
  const exists = await maybeOne(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'schema_migrations'`);
  if (exists) return;
  await query(`create table public.schema_migrations (
    name text primary key, checksum text not null, baseline boolean not null default false,
    applied_at timestamptz not null default now())`);
  // Service role only: RLS on with no policies.
  await query(`alter table public.schema_migrations enable row level security`);
  await query(`revoke all on public.schema_migrations from anon, authenticated`).catch(() => {});
  const legacy = await maybeOne(`select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [BASELINE_PROBE]);
  if (legacy) {
    for (const m of loadMigrations().filter((x) => BASELINE.includes(x.name))) {
      await query(`insert into public.schema_migrations (name, checksum, baseline) values ($1, $2, true) on conflict do nothing`, [m.name, m.checksum]);
    }
  }
}

export interface MigrationStatus {
  applied: { name: string; applied_at: Date; baseline: boolean; changed: boolean }[];
  pending: Migration[];
}

export async function migrationStatus(all = loadMigrations()): Promise<MigrationStatus> {
  await ensureTable();
  const rows = await query<{ name: string; checksum: string; applied_at: Date; baseline: boolean }>(
    `select name, checksum, applied_at, baseline from public.schema_migrations order by name`);
  const done = new Map(rows.map((r) => [r.name, r]));
  return {
    applied: rows.map((r) => ({ ...r, changed: all.find((m) => m.name === r.name)?.checksum !== r.checksum })),
    pending: all.filter((m) => !done.has(m.name)),
  };
}

export interface ApplyResult {
  applied: string[];
  /** First pending migration that was not run, and why. */
  stopped?: { name: string; reason: string };
}

/** Applies pending migrations in order; stops at an unconfirmed destructive one or on error. */
export async function applyMigrations(o: {
  confirm?: string;
  deleteBucket?: (bucket: string) => Promise<string>;
  log?: (msg: string) => void;
} = {}): Promise<ApplyResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const { pending } = await migrationStatus();
  const applied: string[] = [];
  for (const m of pending) {
    if (m.destructive && o.confirm !== m.name) {
      return { applied, stopped: { name: m.name, reason: 'destructive: needs explicit confirmation' } };
    }
    try {
      for (const b of m.deleteBuckets) {
        if (!o.deleteBucket) { log(`${m.name}: no storage access here, bucket ${b} left as is`); continue; }
        log(`${m.name}: bucket ${b} ${await o.deleteBucket(b)}`);
      }
      await tx(async (c) => {
        await c.query(m.sql);
        await c.query(`insert into public.schema_migrations (name, checksum) values ($1, $2)`, [m.name, m.checksum]);
      });
    } catch (err) {
      return { applied, stopped: { name: m.name, reason: err instanceof Error ? err.message : String(err) } };
    }
    log(`applied ${m.name}`);
    applied.push(m.name);
  }
  return { applied };
}
