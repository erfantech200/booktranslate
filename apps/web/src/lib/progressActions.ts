'use server';

import { revalidatePath } from 'next/cache';
import { COACH, MEASURES } from '@coach/core/shared';
import { latinDigits } from './digits';
import { sanitizeLocalDate } from './format';
import { PHOTO_BUCKET } from './photos';
import { requireUser } from './supabase/server';

export type MeasureState = { ok?: boolean; error?: 'empty' | 'invalid' | 'failed'; field?: string; values?: Record<string, string> } | null;

/**
 * Save tape measurements for a day. Only the fields filled in are written; the day's weigh-in
 * (same row) and any other measurement already saved for that day are kept.
 */
export async function saveMeasurements(_: MeasureState, form: FormData): Promise<MeasureState> {
  // Echoed back so a rejected form keeps what was typed (React resets the form after an action).
  const values = Object.fromEntries(MEASURES.map((k) => [k, String(form.get(k) ?? '')]));
  const row: Record<string, number> = {};
  for (const k of MEASURES) {
    const raw = latinDigits(String(form.get(k) ?? '')).trim().replace('/', '.');
    if (!raw) continue;
    const v = Number(raw);
    const [lo, hi] = COACH.progress.measureCm[k];
    if (!Number.isFinite(v) || v < lo || v > hi) return { error: 'invalid', field: k, values };
    row[`${k}_cm`] = Math.round(v * 10) / 10;
  }
  if (!Object.keys(row).length) return { error: 'empty', values };
  const { sb, user } = await requireUser();
  const { error } = await sb.from('body_metrics').upsert({ user_id: user.id, date: sanitizeLocalDate(form.get('date')), ...row }, { onConflict: 'user_id,date' });
  if (error) return { error: 'failed', values };
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Clear one day's measurements; the row goes too when it has no weigh-in. */
export async function deleteMeasurements(id: string) {
  const { sb } = await requireUser();
  await sb.from('body_metrics').update({ waist_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null }).eq('id', id);
  await sb.from('body_metrics').delete().eq('id', id).is('weight_kg', null);
  revalidatePath('/', 'layout');
}

/** Delete one progress photo (row and file). */
export async function deletePhoto(id: string) {
  const { sb } = await requireUser();
  const { data } = await sb.from('progress_photos').select('storage_path').eq('id', id).maybeSingle();
  if (!data) return;
  await sb.from('progress_photos').delete().eq('id', id);
  await sb.storage.from(PHOTO_BUCKET).remove([data.storage_path]);
  revalidatePath('/', 'layout');
}
