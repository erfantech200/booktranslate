import 'server-only';
import type { WeighIn } from '@coach/core/shared';
import type { supabaseServer } from './supabase/server';

export interface WeighInRow extends WeighIn { id: string }

/** Every weigh-in, oldest first (one per day; a year is ~365 small rows). */
export async function loadWeighIns(sb: Awaited<ReturnType<typeof supabaseServer>>): Promise<WeighInRow[]> {
  const { data } = await sb.from('body_metrics').select('id, date, weight_kg').not('weight_kg', 'is', null).order('date');
  return (data ?? []).map((r) => ({ id: r.id, date: r.date, weightKg: Number(r.weight_kg) }));
}
