'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  BODY_AREAS, mustStop, RED_FLAGS, recurringPain, summarize, substitutesFor, weekContext,
  type PlannedExercise, type SessionPlan,
} from '@coach/core/shared';
import type { SwapResult } from '@/components/gym/types';
import { latinDigits } from './digits';
import { sanitizeLocalDate } from './format';
import { loadLibrary } from './library';
import { requireProfile } from './profile';
import { localToday } from './today';
import {
  buildBlock, eligibilityFor, gymInfo, isoMinusDays, loadActiveMeso, loadExcluded, loadHistory, loadSessions, mesoInfo, preparePlan,
  sessionOf, swapInPlan, weekView,
} from './training';

// Workout actions, as the signed-in user (RLS). Numbers come from the engine; nothing here
// prescribes a load or a set count by itself.

const done = () => revalidatePath('/', 'layout');

/** Build the first block, the next one, or rebuild after settings changed. */
export async function createBlock(reason: 'first' | 'completed' | 'rebuilt') {
  const { sb, user, profile } = await requireProfile();
  const { data: active } = await sb.from('workout_sessions').select('id').eq('status', 'active').maybeSingle();
  if (active) redirect('/gym');
  await buildBlock(sb, user.id, profile, await localToday(), reason);
  done();
  redirect('/workout');
}

export async function startWorkout(form: FormData) {
  const { sb, user, profile } = await requireProfile();
  const { data: active } = await sb.from('workout_sessions').select('id').eq('status', 'active').maybeSingle();
  if (active) redirect('/gym');
  const block = await loadActiveMeso(sb);
  if (!block) redirect('/workout');
  const today = sanitizeLocalDate(form.get('date') ?? (await localToday()));
  const sessions = await loadSessions(sb, block.meso.id);
  const view = weekView(block.meso, block.days, sessions, today);
  const dayIdx = Number(form.get('day') ?? view.state.next?.dayIdx ?? 0);
  if (!block.days[dayIdx]) redirect('/workout');
  // Merging takes the next unhandled day after this one.
  let mergeWith: number | null = null;
  if (form.get('merge') === '1') {
    mergeWith = block.days.findIndex((d) => d.idx !== dayIdx && !view.handled.has(d.idx) && d.idx > dayIdx);
    if (mergeWith < 0) mergeWith = null;
  }
  const dropLastSet = form.get('dropLastSet') === '1';
  const plan = await preparePlan(sb, { profile, meso: block.meso, days: block.days, dayIdx, mergeWith, today, dropLastSet });
  const { error } = await sb.from('workout_sessions').insert({
    user_id: user.id, mesocycle_id: block.meso.id, week: Math.min(block.meso.weeks, Math.max(1, view.weekNow)), day_idx: dayIdx,
    merged_day_idx: mergeWith, date: today, status: 'active', deload: plan.deload, low_readiness: dropLastSet,
    plan: { ...plan, rev: 0 }, started_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  done();
  redirect('/gym');
}

/** Missed session → skip it (never made up by doubling volume, spec §8). */
export async function skipDay(dayIdx: number) {
  const { sb, user } = await requireProfile();
  const block = await loadActiveMeso(sb);
  if (!block || !block.days[dayIdx]) return;
  const today = await localToday();
  const view = weekView(block.meso, block.days, await loadSessions(sb, block.meso.id), today);
  if (view.handled.has(dayIdx)) return;
  await sb.from('workout_sessions').insert({
    user_id: user.id, mesocycle_id: block.meso.id, week: Math.max(1, view.weekNow), day_idx: dayIdx, date: today, status: 'skipped',
  });
  done();
}

export async function acceptEarlyDeload(reason: 'regression' | 'readiness') {
  const { sb, profile } = await requireProfile();
  const block = await loadActiveMeso(sb);
  if (!block) return;
  const wc = weekContext(mesoInfo(block.meso), profile.experience ?? 'none', await localToday());
  if (wc.deload) return;
  await sb.from('mesocycles').update({ deload_week: wc.week, early_deload_reason: reason }).eq('id', block.meso.id);
  done();
}

// ─── Readiness ────────────────────────────────────────────────────────────────────────────
const ReadinessInput = z.object({
  sleepHours: z.coerce.number().min(0).max(16).optional(),
  energy: z.coerce.number().int().min(1).max(5).optional(),
  soreness: z.coerce.number().int().min(1).max(5).optional(),
});
export type ReadinessState = { ok?: boolean; error?: boolean } | null;

export async function saveReadiness(_: ReadinessState, form: FormData): Promise<ReadinessState> {
  const val = (k: string) => { const v = latinDigits(String(form.get(k) ?? '')).trim(); return v === '' ? undefined : v; };
  const parsed = ReadinessInput.safeParse({ sleepHours: val('sleepHours'), energy: val('energy'), soreness: val('soreness') });
  if (!parsed.success) return { error: true };
  const { sb, user } = await requireProfile();
  const { error } = await sb.from('readiness').upsert({
    user_id: user.id, date: sanitizeLocalDate(form.get('date')),
    sleep_hours: parsed.data.sleepHours ?? null, energy: parsed.data.energy ?? null, soreness: parsed.data.soreness ?? null,
  }, { onConflict: 'user_id,date' });
  if (error) return { error: true };
  done();
  return { ok: true };
}

// ─── During a session ─────────────────────────────────────────────────────────────────────
async function activeSession(sessionId: string) {
  const ctx = await requireProfile();
  const { data } = await ctx.sb.from('workout_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!data || data.status !== 'active') throw new Error('session not active');
  return { ...ctx, row: sessionOf(data) };
}

/** Substitutes the owner can do now (spec §8: swap exercise mid-workout). */
export async function substituteOptions(slug: string): Promise<{ slug: string; nameFa: string }[]> {
  const { sb, profile } = await requireProfile();
  const [library, excluded] = await Promise.all([loadLibrary(), loadExcluded(sb)]);
  const e = library.find((x) => x.slug === slug);
  if (!e) return [];
  return substitutesFor(e, library, eligibilityFor(profile, excluded, 3)).slice(0, 8).map((x) => ({ slug: x.slug, nameFa: x.nameFa }));
}

/** Swap exercise `exIdx` for today, or for the rest of the block. Returns the new prescription. */
export async function swapExercise(sessionId: string, exIdx: number, slug: string, scope: 'today' | 'block'): Promise<SwapResult> {
  const { sb, profile, row } = await activeSession(sessionId);
  const plan = row.plan!;
  const next = await swapInPlan(sb, profile, plan, exIdx, slug);
  const old = plan.exercises[exIdx]!;
  const exercises = plan.exercises.map((x, i) => (i === exIdx ? next : x));
  await sb.from('workout_sessions').update({ plan: { ...plan, exercises } }).eq('id', sessionId);
  if (scope === 'block') {
    const { data: day } = await sb.from('program_days').select('id').eq('mesocycle_id', (await loadActiveMeso(sb))!.meso.id).eq('idx', row.dayIdx).maybeSingle();
    if (day) await sb.from('program_exercises').update({ slug, replaced_from: old.swappedFrom ?? old.slug }).eq('program_day_id', day.id).eq('slug', old.slug);
  }
  const e = (await loadLibrary()).find((x) => x.slug === slug)!;
  return { planned: next, info: gymInfo(e) };
}

// ─── Pain (spec §6) ───────────────────────────────────────────────────────────────────────
const PainInput = z.object({
  sessionId: z.string().uuid().nullable(),
  slug: z.string().max(80).nullable(),
  area: z.enum([...BODY_AREAS, 'neck', 'upper_back', 'other'] as [string, ...string[]]),
  level: z.number().int().min(0).max(10),
  sharp: z.boolean(),
  redFlag: z.enum(RED_FLAGS).nullable(),
  date: z.string(),
});
export interface PainResult { stop: boolean; excluded: boolean; recurring: boolean; redFlag: boolean }

export async function reportPain(raw: z.input<typeof PainInput>): Promise<PainResult> {
  const p = PainInput.parse(raw);
  const { sb, user } = await requireProfile();
  const date = sanitizeLocalDate(p.date);
  await sb.from('pain_reports').insert({
    user_id: user.id, date, slug: p.slug, session_id: p.sessionId, area: p.area, level: p.level, sharp: p.sharp, red_flag: p.redFlag,
  });
  const stop = !!p.redFlag || mustStop(p.level, p.sharp);
  let excluded = false;
  if (stop && p.slug) {
    const { error } = await sb.from('exercise_prefs').upsert(
      { user_id: user.id, slug: p.slug, excluded: true, excluded_reason: 'pain', excluded_at: new Date().toISOString() },
      { onConflict: 'user_id,slug' },
    );
    excluded = !error;
  }
  const { data: reports } = await sb.from('pain_reports').select('date, area, level').gte('date', isoMinusDays(date, 60));
  done();
  return { stop, excluded, recurring: recurringPain(reports ?? [], p.area, date), redFlag: !!p.redFlag };
}

/** Put an exercise back after it was removed for pain (or remove it by hand). */
export async function setExcluded(slug: string, excluded: boolean) {
  const { sb, user } = await requireProfile();
  await sb.from('exercise_prefs').upsert(
    { user_id: user.id, slug, excluded, excluded_reason: excluded ? 'manual' : null, excluded_at: excluded ? new Date().toISOString() : null },
    { onConflict: 'user_id,slug' },
  );
  done();
}

// ─── Finish / discard ─────────────────────────────────────────────────────────────────────
export async function finishWorkout(sessionId: string) {
  const { sb, row } = await activeSession(sessionId);
  const library = await loadLibrary();
  const bySlug = new Map(library.map((e) => [e.slug, e]));
  const { data: sets } = await sb.from('set_logs').select('slug, weight_kg, reps, rir, is_warmup, logged_at').eq('session_id', sessionId);
  const slugs = [...new Set((sets ?? []).map((s) => s.slug))];
  const { bests } = await loadHistory(sb, slugs);
  const finishedAt = new Date().toISOString();
  const summary = summarize({
    startedAt: row.startedAt ?? finishedAt, finishedAt, bestsBefore: bests, bySlug,
    sets: (sets ?? []).map((s) => ({ slug: s.slug, weight: Number(s.weight_kg), reps: s.reps, rir: s.rir == null ? null : Number(s.rir), isWarmup: s.is_warmup, loggedAt: s.logged_at })),
  });
  const { error } = await sb.from('workout_sessions').update({
    status: 'done', finished_at: finishedAt, summary, comment_status: summary.workingSets > 0 ? 'pending' : 'none',
  }).eq('id', sessionId);
  if (error) throw new Error(error.message);
  done();
  redirect(`/workout/history/${sessionId}`);
}

/** Throw away a session that was started by mistake (its sets go with it). */
export async function discardWorkout(sessionId: string) {
  const { sb } = await activeSession(sessionId);
  await sb.from('workout_sessions').delete().eq('id', sessionId);
  done();
  redirect('/workout');
}

export type { SessionPlan };
