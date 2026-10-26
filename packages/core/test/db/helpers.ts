import { randomUUID } from 'node:crypto';
import { query } from '../../src/db/pool';

export const RUN = !!process.env.DB_TESTS && !!process.env.DATABASE_URL;

export async function createUser(email: string): Promise<string> {
  const id = randomUUID();
  await query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

/** Run SQL as an authenticated Supabase user (RLS applies), inside a rolled-back transaction. */
export async function asUser<T>(userId: string | null, email: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const { getPool } = await import('../../src/db/pool');
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
