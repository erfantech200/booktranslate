import 'server-only';
import { supabaseServer } from './supabase/server';

const TTL = 600; // signed URL lifetime (seconds); private buckets only

export interface BookCard {
  id: string;
  title: string;
  author: string | null;
  target_lang: string;
  cover: string | null;
  pages_total: number;
  pages_translated: number;
  pages_active: number;
  cost_usd: number;
}

export async function signThumbs(sb: Awaited<ReturnType<typeof supabaseServer>>, paths: (string | null)[]) {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length) return new Map<string, string>();
  const { data } = await sb.storage.from('pages').createSignedUrls(list, TTL);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

export async function listBooks(): Promise<BookCard[]> {
  const sb = await supabaseServer();
  const [{ data: books }, { data: progress }, { data: costs }] = await Promise.all([
    sb.from('books').select('id, title, author, target_lang, cover_page_id, updated_at').order('updated_at', { ascending: false }),
    sb.from('book_progress').select('*'),
    sb.from('book_costs').select('book_id, cost_usd'),
  ]);
  const coverIds = (books ?? []).map((b) => b.cover_page_id).filter(Boolean);
  const { data: covers } = coverIds.length
    ? await sb.from('pages').select('id, thumb_path').in('id', coverIds)
    : { data: [] as { id: string; thumb_path: string | null }[] };
  const urls = await signThumbs(sb, (covers ?? []).map((c) => c.thumb_path));
  return (books ?? []).map((b) => {
    const p = progress?.find((x) => x.book_id === b.id);
    const cover = covers?.find((c) => c.id === b.cover_page_id)?.thumb_path;
    return {
      id: b.id, title: b.title, author: b.author, target_lang: b.target_lang,
      cover: cover ? urls.get(cover) ?? null : null,
      pages_total: Number(p?.pages_total ?? 0), pages_translated: Number(p?.pages_translated ?? 0),
      pages_active: Number(p?.pages_active ?? 0),
      cost_usd: Number(costs?.find((c) => c.book_id === b.id)?.cost_usd ?? 0),
    };
  });
}

export interface BookStatus {
  book: { id: string; title: string; author: string | null; translator_name: string | null; source_lang: string; target_lang: string; settings: Record<string, unknown>; budget_usd: number | null; brief: Record<string, string> | null };
  batches: { id: string; seq: number; status: string; stage: string | null; error: string | null; warnings: any[]; created_at: string }[];
  pages: { id: string; batch_id: string; status: string; printed_page_number: number | null; ordinal: number | null; warnings: any[]; error: string | null; thumb: string | null; split_side: string | null; original_name: string | null }[];
  exports: { id: string; format: string; status: string; options: any; error: string | null; created_at: string; size_bytes: number | null; page_count: number | null }[];
  cost: { cost_usd: number; extract_cost_usd: number; translate_cost_usd: number; glossary_cost_usd: number };
  pausedJobs: number;
  active: boolean;
}

export async function bookStatus(bookId: string): Promise<BookStatus | null> {
  const sb = await supabaseServer();
  const { data: book } = await sb.from('books')
    .select('id, title, author, translator_name, source_lang, target_lang, settings, budget_usd, brief').eq('id', bookId).maybeSingle();
  if (!book) return null;
  const [{ data: batches }, { data: pages }, { data: exports }, { data: cost }, { count: paused }] = await Promise.all([
    sb.from('batches').select('id, seq, status, stage, error, warnings, created_at').eq('book_id', bookId).order('seq'),
    sb.from('pages').select('id, batch_id, status, printed_page_number, ordinal, warnings, error, thumb_path, split_side, original_name')
      .eq('book_id', bookId).neq('status', 'split').order('ordinal', { ascending: true, nullsFirst: false }).order('created_at'),
    sb.from('exports').select('id, format, status, options, error, created_at, size_bytes, page_count').eq('book_id', bookId)
      .order('created_at', { ascending: false }).limit(10),
    sb.from('book_costs').select('cost_usd, extract_cost_usd, translate_cost_usd, glossary_cost_usd').eq('book_id', bookId).maybeSingle(),
    sb.from('jobs').select('id', { count: 'exact', head: true }).eq('book_id', bookId).eq('status', 'paused'),
  ]);
  const urls = await signThumbs(sb, (pages ?? []).map((p) => p.thumb_path));
  const activeBatch = (batches ?? []).some((b) => ['uploading', 'queued', 'processing', 'translating'].includes(b.status));
  const activeExport = (exports ?? []).some((e) => ['queued', 'rendering'].includes(e.status));
  return {
    book: { ...book, budget_usd: book.budget_usd == null ? null : Number(book.budget_usd) },
    batches: batches ?? [],
    pages: (pages ?? []).map(({ thumb_path, ...p }) => ({ ...p, thumb: thumb_path ? urls.get(thumb_path) ?? null : null })),
    exports: exports ?? [],
    cost: {
      cost_usd: Number(cost?.cost_usd ?? 0), extract_cost_usd: Number(cost?.extract_cost_usd ?? 0),
      translate_cost_usd: Number(cost?.translate_cost_usd ?? 0), glossary_cost_usd: Number(cost?.glossary_cost_usd ?? 0),
    },
    pausedJobs: paused ?? 0,
    active: activeBatch || activeExport,
  };
}

export const formatUsd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
