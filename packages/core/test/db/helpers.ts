import { randomUUID } from 'node:crypto';
import { query, one } from '../../src/db/pool.js';

export const RUN = !!process.env.DB_TESTS && !!process.env.DATABASE_URL;

export async function createUser(email: string, allowed = true): Promise<string> {
  const id = randomUUID();
  await query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  if (allowed) await query('insert into public.app_allowlist (email) values (lower($1)) on conflict do nothing', [email]);
  return id;
}

export async function createBook(userId: string, o: { title?: string; translator?: string; budget?: number } = {}): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into public.books (user_id, title, author, translator_name, budget_usd) values ($1, $2, $3, $4, $5) returning id`,
    [userId, o.title ?? 'The Lantern Keeper', 'A. Tester', o.translator ?? 'Erfan', o.budget ?? null]);
  return r.id;
}

export async function createBatch(userId: string, bookId: string, seq: number): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into public.batches (user_id, book_id, seq, status) values ($1, $2, $3, 'queued') returning id`, [userId, bookId, seq]);
  return r.id;
}

/** Run SQL as an authenticated Supabase user (RLS applies), inside a rolled-back transaction. */
export async function asUser<T>(userId: string | null, email: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const { getPool } = await import('../../src/db/pool.js');
  const c = await getPool().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, email, role: 'authenticated' } : {})]);
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    // Savepoint per statement so an expected failure doesn't abort the whole transaction.
    return await fn(async (sql, params = []) => {
      await c.query('savepoint q');
      try {
        const rows = (await c.query(sql, params as any[])).rows;
        await c.query('release savepoint q');
        return rows;
      } catch (err) {
        await c.query('rollback to savepoint q');
        throw err;
      }
    });
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}
