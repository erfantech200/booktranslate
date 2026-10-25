import { NextResponse } from 'next/server';
import { bookStatus } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await bookStatus(id); // RLS: null for books the caller doesn't own
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(s, { headers: { 'cache-control': 'no-store' } });
}
