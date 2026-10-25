import { describe, expect, it } from 'vitest';
import { query, one } from '../../src/db/pool';
import { claimJobs, completeJob, enqueue, failJob, pauseJob, resumePausedJobs } from '../../src/queue';
import { dbCallHooks } from '../../src/usage';
import { BudgetExceededError } from '../../src/openai/structured';
import { asUser, createBatch, createBook, createUser, RUN } from './helpers';

describe.skipIf(!RUN)('queue', () => {
  it('dedupes live jobs and never hands the same job to two workers', async () => {
    const u = await createUser('queue@example.com');
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      enqueue({ userId: u, type: 'extract_page', payload: { pageId: crypto.randomUUID() }, dedupeKey: `q-test-${i % 3}` })));
    expect(ids.filter(Boolean)).toHaveLength(3);

    const [a, b] = await Promise.all([claimJobs('w1', 2, 60), claimJobs('w2', 2, 60)]);
    const claimed = [...a, ...b].filter((j) => j.dedupe_key?.startsWith('q-test-'));
    expect(new Set(claimed.map((j) => j.id)).size).toBe(claimed.length);
    expect(claimed.length).toBe(3);
    for (const j of claimed) await completeJob(j.id);
    // After completion the dedupe key is free again.
    expect(await enqueue({ userId: u, type: 'extract_page', payload: { pageId: crypto.randomUUID() }, dedupeKey: 'q-test-0' })).not.toBeNull();
    await query(`delete from public.jobs where dedupe_key like 'q-test-%'`);
  });

  it('backs off on failure, fails after max attempts, and re-claims expired leases', async () => {
    const u = await createUser('queue2@example.com');
    const id = (await enqueue({ userId: u, type: 'ingest_batch', payload: { batchId: crypto.randomUUID() }, maxAttempts: 2, dedupeKey: 'q-retry' }))!;
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

  it('pauses on budget and resumes', async () => {
    const u = await createUser('budget@example.com');
    const book = await createBook(u, { budget: 0.01 });
    await query(`insert into public.usage_log (user_id, book_id, stage, model, cost_usd) values ($1, $2, 'ocr', 'gpt-6-luna', 0.02)`, [u, book]);
    await expect(dbCallHooks.checkBudget({ userId: u, bookId: book })).rejects.toBeInstanceOf(BudgetExceededError);

    const id = (await enqueue({ userId: u, bookId: book, type: 'translate_batch', payload: { batchId: crypto.randomUUID() } }))!;
    await pauseJob(id, 'budget');
    expect((await one('select status, attempts from public.jobs where id = $1', [id])).status).toBe('paused');
    expect(await resumePausedJobs(u, book)).toBe(1);
    await query('delete from public.jobs where id = $1', [id]);

    await query(`insert into public.user_settings (user_id, monthly_budget_usd) values ($1, 0.01)`, [u]);
    await query('update public.books set budget_usd = null where id = $1', [book]);
    await expect(dbCallHooks.checkBudget({ userId: u, bookId: book })).rejects.toThrow(/Monthly budget/);
  });
});

describe.skipIf(!RUN)('RLS', () => {
  it('isolates users, requires the allowlist, and protects pipeline-owned columns', async () => {
    const a = await createUser('alice@example.com');
    const b = await createUser('bob@example.com');
    const outsider = await createUser('mallory@example.com', false);
    const bookA = await createBook(a, { title: 'Alice book' });
    const batchA = await createBatch(a, bookA, 1);
    const page = await one<{ id: string }>(`insert into public.pages (user_id, book_id, batch_id, status) values ($1,$2,$3,'extracted') returning id`, [a, bookA, batchA]);

    await asUser(a, 'alice@example.com', async (q) => {
      expect((await q('select id from public.books')).map((r) => r.id)).toEqual([bookA]);
      // Editable column: ordinal. Pipeline column: status → permission denied.
      await q('update public.pages set ordinal = 5, manual_order = true where id = $1', [page.id]);
      await expect(q(`update public.pages set status = 'translated' where id = $1`, [page.id])).rejects.toThrow(/permission denied/);
    });
    await asUser(a, 'alice@example.com', async (q) => {
      await expect(q(`insert into public.usage_log (user_id, stage, model) values ($1, 'ocr', 'x')`, [a])).rejects.toThrow(/permission denied/);
      // Users can enqueue their own jobs only in the queued state.
      await q(`insert into public.jobs (user_id, book_id, type, payload) values ($1, $2, 'ingest_batch', '{}')`, [a, bookA]);
      await expect(q(`insert into public.jobs (user_id, type, payload, status) values ($1, 'ingest_batch', '{}', 'done')`, [a])).rejects.toThrow(/row-level security/);
      await expect(q(`insert into public.books (user_id, title) values ($1, 'x')`, [b])).rejects.toThrow(/row-level security/);
    });
    await asUser(b, 'bob@example.com', async (q) => {
      expect(await q('select id from public.books')).toEqual([]);
      expect(await q('select id from public.pages')).toEqual([]);
      expect(await q(`update public.books set title = 'pwned' where id = $1 returning id`, [bookA])).toEqual([]);
    });
    await asUser(outsider, 'mallory@example.com', async (q) => {
      await expect(q(`insert into public.books (user_id, title) values ($1, 'x')`, [outsider])).rejects.toThrow(/row-level security/);
    });
    await asUser(null, null, async (q) => {
      await expect(q('select id from public.books')).rejects.toThrow(/permission denied/);
    });
  });
});
