import { NextResponse, type NextRequest } from 'next/server';
import { BudgetExceededError, EXERCISE_IMAGE_BUCKET, generateExerciseImage, ImageLimitError } from '@coach/core';
import { loadLibrary } from '@/lib/library';
import { supabaseServer } from '@/lib/supabase/server';

// Exercise illustration (spec §7): generated on the first view of an exercise (or on "regenerate"),
// stored once in the private bucket, returned as a short-lived signed URL. The shared exercises row
// is written through the core pool (service role), like the seed.

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const { slug, regenerate } = (await req.json().catch(() => ({}))) as { slug?: string; regenerate?: boolean };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const e = (await loadLibrary()).find((x) => x.slug === slug);
  if (!e) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let path = e.imageStatus === 'ok' ? e.imageUrl : null;
  if (!path || regenerate) {
    if (e.imageStatus === 'flagged' && !regenerate) return NextResponse.json({ status: 'flagged' });
    try {
      path = await generateExerciseImage(user.id, e);
    } catch (err) {
      const code = err instanceof BudgetExceededError ? 'budget' : err instanceof ImageLimitError ? 'limit' : 'failed';
      if (code === 'failed') console.error(JSON.stringify({ msg: 'exercise image failed', slug, err: err instanceof Error ? err.message : String(err) }));
      return NextResponse.json({ status: 'error', error: code });
    }
  }
  const { data } = await sb.storage.from(EXERCISE_IMAGE_BUCKET).createSignedUrl(path, 600);
  return NextResponse.json({ status: 'ok', url: data?.signedUrl ?? null });
}
