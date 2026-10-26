'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { COACH } from '@coach/core/shared';
import { latinDigits } from './digits';
import { sanitizeLocalDate } from './format';
import { requireUser } from './supabase/server';

export type WeighInState = { ok?: boolean; error?: 'invalid' | 'failed' } | null;

const Weight = z.coerce.number().min(COACH.profile.weightKgMin).max(COACH.profile.weightKgMax);

/** Upsert today's weight (one row per day; measurements on the same row are kept). */
export async function logWeight(_: WeighInState, form: FormData): Promise<WeighInState> {
  const parsed = Weight.safeParse(latinDigits(String(form.get('weight') ?? '')));
  if (!parsed.success) return { error: 'invalid' };
  const { sb, user } = await requireUser();
  const { error } = await sb.from('body_metrics').upsert(
    { user_id: user.id, date: sanitizeLocalDate(form.get('date')), weight_kg: Math.round(parsed.data * 100) / 100 },
    { onConflict: 'user_id,date' },
  );
  if (error) return { error: 'failed' };
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Remove a weigh-in; the row goes too when it holds no measurements. */
export async function deleteWeight(id: string) {
  const { sb } = await requireUser();
  await sb.from('body_metrics').update({ weight_kg: null }).eq('id', id);
  await sb.from('body_metrics').delete().eq('id', id)
    .is('waist_cm', null).is('chest_cm', null).is('arm_cm', null).is('thigh_cm', null);
  revalidatePath('/', 'layout');
}
