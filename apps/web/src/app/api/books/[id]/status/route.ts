import { after, NextResponse } from 'next/server';
import { bookStatus } from '@/lib/data';
import { kickWorker } from '@/lib/kick';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await bookStatus(id); // RLS: null for books the caller doesn't own
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // While someone watches the book, make sure a worker run is going: work waiting and no job
  // currently held by a run → start one (after the response, so polling stays fast).
  if (s.active) {
    const sb = await supabaseServer();
    const now = new Date().toISOString();
    const [{ count: waiting }, { count: running }] = await Promise.all([
      sb.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued').lte('run_after', now),
      sb.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'running').gt('locked_until', now),
    ]);
    if ((waiting ?? 0) > 0 && (running ?? 0) === 0) after(() => kickWorker());
  }
  return NextResponse.json(s, { headers: { 'cache-control': 'no-store' } });
}
