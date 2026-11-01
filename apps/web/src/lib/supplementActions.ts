'use server';

import { revalidatePath } from 'next/cache';
import { COACH } from '@coach/core/shared';
import { requireProfile } from './profile';
import { localToday } from './today';

/** Tick or untick today's creatine. Only today: a tick is a record, not a plan. */
export async function toggleCreatine() {
  const { sb, user } = await requireProfile();
  const date = await localToday();
  const { data } = await sb.from('supplement_logs').select('id').eq('kind', 'creatine').eq('date', date).maybeSingle();
  if (data) await sb.from('supplement_logs').delete().eq('id', data.id);
  else await sb.from('supplement_logs').insert({ user_id: user.id, date, kind: 'creatine', grams: COACH.supplements.creatineGramsPerDay });
  revalidatePath('/', 'layout');
}
