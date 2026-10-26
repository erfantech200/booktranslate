import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import sharp, { type OutputInfo } from 'sharp';
import { COACH } from '@coach/core/shared';
import { sanitizeLocalDate } from '@/lib/format';
import { PHOTO_BUCKET } from '@/lib/photos';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Progress photo upload. The browser already downsized and re-encoded the image; here it is
 * decoded and re-encoded once more with sharp (auto-rotated, metadata dropped: no EXIF, GPS or
 * device data survives), then stored in the private bucket under the owner's folder.
 */
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const angle = String(form.get('angle'));
  if (!(file instanceof File) || !['front', 'side', 'back'].includes(angle)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'too large' }, { status: 413 });
  const date = sanitizeLocalDate(form.get('date'));

  let out: { data: Buffer; info: OutputInfo };
  try {
    const max = COACH.photos.maxLongSidePx;
    out = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'error' })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: Math.round(COACH.photos.jpegQuality * 100), mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return NextResponse.json({ error: 'not an image' }, { status: 415 });
  }

  const path = `${user.id}/${date}-${angle}-${randomUUID().slice(0, 8)}.jpg`;
  const { error: ue } = await sb.storage.from(PHOTO_BUCKET).upload(path, out.data, { contentType: 'image/jpeg', upsert: false });
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });

  // One photo per angle per day: replace an earlier one.
  const { data: old } = await sb.from('progress_photos').select('id, storage_path').eq('taken_on', date).eq('angle', angle);
  const { data: row, error: ie } = await sb.from('progress_photos')
    .insert({ user_id: user.id, taken_on: date, angle, storage_path: path, width: out.info.width, height: out.info.height })
    .select('id').single();
  if (ie) {
    await sb.storage.from(PHOTO_BUCKET).remove([path]);
    return NextResponse.json({ error: ie.message }, { status: 500 });
  }
  if (old?.length) {
    await sb.from('progress_photos').delete().in('id', old.map((o) => o.id));
    await sb.storage.from(PHOTO_BUCKET).remove(old.map((o) => o.storage_path));
  }
  const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, COACH.photos.signedUrlSeconds);
  return NextResponse.json({ id: row.id, url: signed?.signedUrl ?? null });
}
