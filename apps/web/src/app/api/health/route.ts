import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { type NextRequest } from 'next/server';
import { migrationStatus, seedStatus } from '@coach/core';

// Setup check: /api/health?key=<CRON_SECRET>. Shows ✅/❌ for every part the app depends on,
// with a hint for each failure. Never prints secret values. Without the key, only the
// environment-variable checks are shown (so a broken setup can still be diagnosed).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Check { name: string; ok: boolean | null; detail?: string; hint?: string }

const clip = (s: unknown, n = 220) => String(s instanceof Error ? s.message : s).replace(/postgres(ql)?:\/\/[^\s]+/g, '[connection string]').slice(0, n);

async function timed<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

export async function GET(req: NextRequest) {
  const checks: Check[] = [];
  const env = (k: string) => (process.env[k] ?? '').trim();
  // Static access on purpose: NEXT_PUBLIC_* are baked in at build time, and these are the values
  // the site actually uses (a variable added later only takes effect after a redeploy).
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  const service = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  const dbUrl = env('DATABASE_URL');
  const openai = env('OPENAI_API_KEY');
  const secret = env('CRON_SECRET');

  // ── Environment variables ──
  checks.push({ name: 'Supabase URL (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)', ok: /^https:\/\/[^/\s]+\/?$/.test(url),
    hint: 'Supabase → Project Settings → API → Project URL, e.g. https://abcd.supabase.co (nothing after it). Redeploy after changing.' });
  checks.push({ name: 'Supabase publishable key (SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)', ok: anon.length > 20,
    hint: 'Supabase → Project Settings → API Keys: the publishable (sb_publishable_…) or legacy "anon" key. Redeploy after changing.' });
  checks.push({ name: 'Supabase secret key (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY)', ok: service.length > 20,
    hint: 'Same page: the secret (sb_secret_…) or legacy "service_role" key.' });
  // Show user@host:port (never the password) so a wrong connection string is easy to spot.
  let dbShape: string | undefined;
  try {
    const u = new URL(dbUrl);
    dbShape = `user=${decodeURIComponent(u.username)} host=${u.hostname} port=${u.port || '5432'}${u.port === '6543' ? '' : ' (should be 6543)'}`;
  } catch {
    dbShape = dbUrl ? 'not a valid URL — if the password has characters like @ # / ? use a letters-and-digits password' : undefined;
  }
  checks.push({ name: 'DATABASE_URL', ok: /^postgres(ql)?:\/\//.test(dbUrl), detail: dbShape,
    hint: 'Supabase → Connect → Transaction pooler (port 6543), with your database password filled in.' });
  checks.push({ name: 'OPENAI_API_KEY', ok: openai.startsWith('sk-'), hint: 'platform.openai.com → API keys.' });
  checks.push({ name: 'CRON_SECRET', ok: secret.length >= 16, hint: 'Any long random string.' });

  const authorized = secret.length >= 16 && req.nextUrl.searchParams.get('key') === secret;
  if (!authorized) {
    checks.push({ name: 'Detailed checks', ok: null, detail: 'Add ?key=<your CRON_SECRET> to the address to run the connection checks.' });
    return render(checks);
  }

  // ── Supabase API + keys ──
  if (url && anon) {
    try {
      const r = await timed(fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: anon } }));
      const body = r.ok ? await r.json() as { disable_signup?: boolean; external?: { email?: boolean } } : null;
      checks.push({ name: 'Supabase reachable + publishable/anon key accepted', ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}`,
        hint: 'Check the Project URL and the anon/publishable key belong to the same project.' });
      if (body) {
        checks.push({ name: 'Email sign-in enabled', ok: body.external?.email !== false, hint: 'Authentication → Sign In / Providers → Email: enable it.' });
        checks.push({ name: 'Public sign-up turned off', ok: body.disable_signup === true,
          hint: 'Authentication → Sign In / Providers: turn off "Allow new users to sign up" (single owner).' });
      }
    } catch (e) {
      checks.push({ name: 'Supabase reachable', ok: false, detail: clip(e) });
    }
  }
  if (url && service) {
    try {
      const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await timed(admin.storage.listBuckets());
      checks.push({ name: 'Service key accepted', ok: !error, detail: error ? clip(error.message) : `buckets: ${(data ?? []).map((b) => b.name).join(', ') || 'none'}`,
        hint: 'Check SUPABASE_SECRET_KEY (secret / service_role key of the same project).' });
      const { data: users } = await timed(admin.auth.admin.listUsers({ page: 1, perPage: 50 }));
      const n = users?.users.length ?? 0;
      checks.push({ name: 'Owner account (exactly one)', ok: n === 1, detail: `${n} account(s)`,
        hint: n === 0 ? 'Authentication → Users → Add user (tick Auto Confirm User).' : 'This app has a single owner: delete the extra accounts in Authentication → Users.' });
    } catch (e) {
      checks.push({ name: 'Service key / accounts', ok: false, detail: clip(e) });
    }
  }

  // ── Database ──
  if (dbUrl) {
    const client = new pg.Client({ connectionString: dbUrl, ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? undefined : { rejectUnauthorized: false } });
    try {
      await timed(client.connect());
      checks.push({ name: 'Database connection', ok: true });
      try {
        const m = await timed(migrationStatus());
        checks.push({ name: 'Migrations', ok: m.pending.length === 0 && !m.applied.some((a) => a.changed),
          detail: `${m.applied.length} applied${m.pending.length ? `; pending: ${m.pending.map((p) => p.name + (p.destructive ? ' (destructive)' : '')).join(', ')}` : ''}`
            + (m.applied.some((a) => a.changed) ? `; changed after applying: ${m.applied.filter((a) => a.changed).map((a) => a.name).join(', ')}` : ''),
          hint: 'Run /api/admin/migrate?key=…&apply=1 (destructive ones also need &confirm=<file>).' });
      } catch (e) {
        checks.push({ name: 'Migrations', ok: false, detail: clip(e) });
      }
      try {
        for (const seed of await timed(seedStatus())) {
          checks.push({ name: `Seed: ${seed.name}`, ok: seed.missing === 0 && seed.changed === 0,
            detail: `${seed.total - seed.missing} of ${seed.total}${seed.changed ? `; ${seed.changed} out of date` : ''}`,
            hint: 'Run /api/admin/migrate?key=…&apply=1 to sync the seeds.' });
        }
      } catch (e) {
        checks.push({ name: 'Seeds', ok: false, detail: clip(e), hint: 'Apply the pending migrations first.' });
      }
      const t = await client.query<{ name: string }>(
        `select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
      const counts: string[] = [];
      for (const { name } of t.rows) {
        const n = await client.query<{ n: number }>(`select count(*)::int as n from public.${pg.escapeIdentifier(name)}`);
        counts.push(`${name}: ${n.rows[0]!.n}`);
      }
      checks.push({ name: 'Table row counts', ok: null, detail: counts.join(', ') || 'no tables' });
      const files = await client.query<{ id: string; n: number; mb: string }>(
        `select b.id, count(o.id)::int as n, round(coalesce(sum((o.metadata->>'size')::bigint), 0) / 1e6, 1)::text as mb
         from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id order by b.id`);
      checks.push({ name: 'Storage', ok: null, detail: files.rows.map((r) => `${r.id}: ${r.n} files, ${r.mb} MB`).join(', ') || 'no buckets' });
      const tables = new Set(t.rows.map((r) => r.name));
      if (tables.has('ai_usage')) {
        const spent = await client.query<{ usd: string }>(`select coalesce(sum(cost_usd), 0)::text as usd from public.ai_usage where created_at >= date_trunc('month', now())`);
        const cap = Number(env('OPENAI_MONTHLY_BUDGET_USD') || 20);
        checks.push({ name: 'AI spend this month', ok: Number(spent.rows[0]!.usd) < cap, detail: `$${Number(spent.rows[0]!.usd).toFixed(2)} of $${cap.toFixed(2)}`,
          hint: 'Budget reached: non-essential AI features are paused until next month or until OPENAI_MONTHLY_BUDGET_USD is raised.' });
      }
      if (tables.has('jobs')) {
        const s = await client.query<{ status: string; n: number }>('select status, count(*)::int as n from public.jobs group by status');
        const failed = await client.query<{ type: string; last_error: string; updated_at: Date }>(
          `select type, last_error, updated_at from public.jobs where status = 'failed' and updated_at > now() - interval '7 days' order by updated_at desc limit 5`);
        checks.push({ name: 'Jobs', ok: null, detail: s.rows.map((r) => `${r.status}: ${r.n}`).join(', ') || 'no jobs yet' });
        for (const j of failed.rows) {
          checks.push({ name: `Failed job (${j.type}, ${j.updated_at.toISOString().slice(0, 16)})`, ok: false, detail: clip(j.last_error, 400) });
        }
      }
    } catch (e) {
      checks.push({ name: 'Database connection', ok: false, detail: clip(e),
        hint: /password authentication failed|Tenant or user not found/i.test(String(e))
          ? 'Expected user=postgres.<project-id>, host=…pooler.supabase.com, port=6543. If those match, the password is wrong: reset it in Supabase (Project Settings → Database) using only letters and digits, and paste it into the string.'
          : 'Use the Transaction pooler string (Shared pooler, port 6543) and put your database password in it (no [ ] brackets).' });
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ── OpenAI ──
  if (openai) {
    const models = [env('OPENAI_TEXT_MODEL') || 'gpt-6.1-sol', env('OPENAI_VISION_MODEL') || 'gpt-6-luna', env('OPENAI_IMAGE_MODEL') || 'gpt-image-2.5-flare'];
    for (const m of [...new Set(models)]) {
      try {
        const r = await timed(fetch(`https://api.openai.com/v1/models/${encodeURIComponent(m)}`, { headers: { authorization: `Bearer ${openai}` } }));
        checks.push({ name: `OpenAI model ${m}`, ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}`,
          hint: r.status === 401 ? 'The OpenAI key is wrong or revoked.' : r.status === 404 ? 'Your OpenAI account has no access to this model (check billing / organization verification).' : undefined });
      } catch (e) {
        checks.push({ name: `OpenAI model ${m}`, ok: false, detail: clip(e) });
      }
    }
  }

  return render(checks);
}

function render(checks: Check[]) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const bad = checks.filter((c) => c.ok === false).length;
  const rows = checks.map((c) => `<tr><td>${c.ok === null ? 'ℹ️' : c.ok ? '✅' : '❌'}</td><td><b>${esc(c.name)}</b>${
    c.detail ? `<br><small>${esc(c.detail)}</small>` : ''}${c.ok === false && c.hint ? `<br><small style="color:#9a3412">${esc(c.hint)}</small>` : ''}</td></tr>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setup check</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem">
<h1>${bad ? `❌ ${bad} problem(s)` : '✅ Everything checked is OK'}</h1>
<table cellpadding="6" style="border-collapse:collapse">${rows}</table></body>`;
  return new Response(html, { status: bad ? 500 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
