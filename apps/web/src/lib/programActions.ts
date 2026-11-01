'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addDays, ProgramSettingsInput, resumeShiftDays } from '@coach/core/shared';
import { normalizeDigits } from './digits';
import type { SaveResult } from './profileActions';
import { requireProfile } from './profile';
import { localToday } from './today';
import { buildBlock, loadActiveProgram, programOf, programProfileFields, type Program } from './training';

// Several training programs (spec §6 builds one block at a time; the owner can keep a few plans, e.g.
// gym and home, and switch). One program is active. A paused program's block keeps its place: on
// resume its start date moves forward by the pause, so it picks up on the day it left off.

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];
const done = () => revalidatePath('/', 'layout');

async function workoutRunning(sb: SB) {
  const { data } = await sb.from('workout_sessions').select('id').eq('status', 'active').maybeSingle();
  return !!data;
}

async function pause(sb: SB, programId: string, today: string) {
  await sb.from('mesocycles').update({ paused_at: today }).eq('program_id', programId).eq('status', 'active').is('paused_at', null);
  await sb.from('programs').update({ active: false }).eq('id', programId);
}

async function resume(sb: SB, userId: string, program: Program, today: string) {
  const { error } = await sb.from('programs').update({ active: true }).eq('id', program.id);
  if (error) throw new Error(error.message);
  const { data: m } = await sb.from('mesocycles').select('id, start_date, paused_at').eq('program_id', program.id).eq('status', 'active').maybeSingle();
  if (m?.paused_at) {
    await sb.from('mesocycles').update({ start_date: addDays(m.start_date, resumeShiftDays(m.paused_at, today)), paused_at: null }).eq('id', m.id);
  }
  // The profile's training fields mirror the active program (nutrition and Settings read them).
  await sb.from('profile').update(programProfileFields(program)).eq('user_id', userId);
}

/** New program with its own settings; it becomes the active one and gets its first block. */
export async function createProgram(raw: unknown): Promise<SaveResult> {
  const parsed = ProgramSettingsInput.safeParse(normalizeDigits(raw));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ''), code: i.code === 'custom' ? i.message : 'invalid' })) };
  }
  const v = parsed.data;
  const { sb, user, profile } = await requireProfile();
  if (await workoutRunning(sb)) return { ok: false, issues: [{ path: '', code: 'workout_running' }] };
  const today = await localToday();
  const cur = await loadActiveProgram(sb);
  if (cur) await pause(sb, cur.id, today);
  const { data, error } = await sb.from('programs').insert({
    user_id: user.id, name: v.name ?? null, active: true, train_location: v.trainLocation,
    equipment: v.trainLocation === 'home' ? v.equipment : [], days_per_week: v.daysPerWeek, session_minutes: v.sessionMinutes,
    preferred_days: v.preferredDays,
  }).select('*').single();
  try {
    if (error || !data) throw new Error(error?.message ?? 'program insert failed');
    const program = programOf(data);
    await buildBlock(sb, user.id, profile, program, today, 'first');
    await sb.from('profile').update(programProfileFields(program)).eq('user_id', user.id);
  } catch (err) {
    if (data) await sb.from('programs').delete().eq('id', data.id);
    if (cur) await resume(sb, user.id, cur, today);
    throw err;
  }
  done();
  return { ok: true };
}

/** Make another program the active one (the current one is paused where it is). */
export async function switchProgram(programId: string) {
  const { sb, user } = await requireProfile();
  if (await workoutRunning(sb)) redirect('/gym');
  const { data } = await sb.from('programs').select('*').eq('id', programId).maybeSingle();
  if (!data) redirect('/workout/programs');
  const target = programOf(data);
  if (!target.active) {
    const today = await localToday();
    const cur = await loadActiveProgram(sb);
    if (cur) await pause(sb, cur.id, today);
    try {
      await resume(sb, user.id, target, today);
    } catch (err) {
      if (cur) await resume(sb, user.id, cur, today);
      throw err;
    }
  }
  done();
  redirect('/workout');
}

export async function renameProgram(programId: string, form: FormData) {
  const { sb } = await requireProfile();
  const name = String(form.get('name') ?? '').trim().slice(0, 60);
  await sb.from('programs').update({ name: name || null }).eq('id', programId);
  done();
}

/**
 * Delete a program and its plan. Finished workouts are history and stay (strength charts, records,
 * the journey): blocks that hold them are kept, closed as "deleted" and unlinked. A workout running
 * in this program is cancelled with it.
 */
export async function deleteProgram(programId: string) {
  const { sb } = await requireProfile();
  const { data: prog } = await sb.from('programs').select('id').eq('id', programId).maybeSingle();
  if (!prog) redirect('/workout/programs');
  const { data: mesos } = await sb.from('mesocycles').select('id, status').eq('program_id', programId);
  const ids = (mesos ?? []).map((m) => m.id);
  if (ids.length) {
    const { error: e0 } = await sb.from('workout_sessions').delete().in('mesocycle_id', ids).eq('status', 'active');
    if (e0) throw new Error(e0.message);
    const { data: withHistory } = await sb.from('workout_sessions').select('mesocycle_id').in('mesocycle_id', ids).eq('status', 'done');
    const keep = new Set((withHistory ?? []).map((s) => s.mesocycle_id as string));
    const drop = ids.filter((id) => !keep.has(id));
    if (drop.length) {
      const { error } = await sb.from('mesocycles').delete().in('id', drop);
      if (error) throw new Error(error.message);
    }
    const openKept = (mesos ?? []).filter((m) => keep.has(m.id) && m.status === 'active').map((m) => m.id);
    if (openKept.length) {
      const { error } = await sb.from('mesocycles').update({ status: 'done', ended_reason: 'deleted', ended_at: new Date().toISOString(), paused_at: null }).in('id', openKept);
      if (error) throw new Error(error.message);
    }
  }
  const { error } = await sb.from('programs').delete().eq('id', programId);
  if (error) throw new Error(error.message);
  done();
  redirect('/workout/programs');
}
