import 'server-only';

// PostgREST returns at most 1000 rows per request (Supabase default). Histories that grow all
// year (set logs, food logs) are read page by page so nothing is silently cut off.

const PAGE = 1000;

/** `query(from, to)` must build a fresh, stably ordered query each time. */
export async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
