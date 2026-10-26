import 'server-only';
import { COACH } from '@coach/core/shared';
import type { supabaseServer } from './supabase/server';

export const PHOTO_BUCKET = 'progress-photos';
export type Angle = 'front' | 'side' | 'back';
export interface PhotoView { id: string; angle: Angle; taken_on: string; url: string }

/** Photos of one day (or all when no date), with short-lived signed URLs (owner session, storage RLS). */
export async function loadPhotos(sb: Awaited<ReturnType<typeof supabaseServer>>, date?: string): Promise<PhotoView[]> {
  let q = sb.from('progress_photos').select('id, angle, taken_on, storage_path').order('taken_on', { ascending: false });
  if (date) q = q.eq('taken_on', date);
  const { data } = await q;
  if (!data?.length) return [];
  const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(data.map((p) => p.storage_path), COACH.photos.signedUrlSeconds);
  const urls = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  return data.filter((p) => urls.has(p.storage_path)).map((p) => ({ id: p.id, angle: p.angle as Angle, taken_on: p.taken_on, url: urls.get(p.storage_path)! }));
}
