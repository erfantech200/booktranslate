'use server';

import { revalidatePath } from 'next/cache';
import { applyAdjustment } from './adjustments';
import { adjustmentOf } from './checkin';
import { requireProfile } from './profile';
import { localToday } from './today';

// Approve or dismiss a proposed change (check-in or coach). Nothing changes without this tap.

export async function decideAdjustment(id: string, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  const { sb, user, profile } = await requireProfile();
  const { data } = await sb.from('adjustments').select('*').eq('id', id).maybeSingle();
  if (!data) return { ok: false, error: 'not_found' };
  const a = adjustmentOf(data);
  if (a.status !== 'proposed' && !(a.type === 'add_note' && a.status === 'approved' && !approve)) return { ok: false, error: 'decided' };
  const now = new Date().toISOString();
  if (!approve) {
    await sb.from('adjustments').update({ status: 'dismissed', decided_at: now }).eq('id', id);
    revalidatePath('/', 'layout');
    return { ok: true };
  }
  let error: string | null;
  try {
    error = await applyAdjustment(sb, user.id, profile, a, await localToday());
  } catch (err) {
    console.error(JSON.stringify({ msg: 'adjustment failed', type: a.type, err: err instanceof Error ? err.message : String(err) }));
    error = 'failed';
  }
  await sb.from('adjustments').update({ status: error ? 'failed' : 'approved', error, decided_at: now }).eq('id', id);
  revalidatePath('/', 'layout');
  return error ? { ok: false, error } : { ok: true };
}

/** Remove an approved coach note from the workout screen. */
export async function removeNote(id: string) {
  await decideAdjustment(id, false);
}
