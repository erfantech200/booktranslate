import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** Redirect to a short-lived signed URL for the export (private bucket). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: ex } = await sb.from('exports').select('storage_path, format, status, book_id').eq('id', id).maybeSingle();
  if (!ex || ex.status !== 'done' || !ex.storage_path) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: book } = await sb.from('books').select('title').eq('id', ex.book_id).maybeSingle();
  const name = `${(book?.title ?? 'book').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)}.${ex.format}`;
  const { data, error } = await sb.storage.from('exports').createSignedUrl(ex.storage_path, 300, { download: name });
  if (error || !data) return NextResponse.json({ error: 'could not sign' }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { 'cache-control': 'no-store' } });
}
