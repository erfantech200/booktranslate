import 'server-only';
import { COACH, substitutesFor, toDay, weekContext } from '@coach/core/shared';
import type { Proposal } from '@coach/core';
import type { AdjustmentRow } from './checkin';
import { lastCalorieChange } from './checkin';
import { loadLibrary } from './library';
import { ensureTargets, loadPlan, weekStartOf, writeTargets } from './nutrition';
import type { Profile } from './profile';
import type { supabaseServer } from './supabase/server';
import { eligibilityFor, loadActiveMeso, loadExcluded, loadSessions, mesoInfo, weekView } from './training';

// Proposed changes (check-in and coach chat) are validated against the engine's bounds twice: when
// they are proposed, and again when the owner taps approve (data may have changed in between).
// Only then are they applied. Every decision is kept in `adjustments` (the audit trail).

type SB = Awaited<ReturnType<typeof supabaseServer>>;
export type Invalid = { error: string };

export interface ProposalRow { type: AdjustmentRow['type']; before: unknown; after: Record<string, unknown>; reason: string }

/** Check a coach proposal and turn it into an adjustments row, or say why it can't be offered. */
export async function validateProposal(sb: SB, profile: Profile, p: Proposal, today: string): Promise<ProposalRow | Invalid> {
  switch (p.type) {
    case 'swap_exercise': {
      const r = await checkSwap(sb, profile, p.from, p.to);
      return 'error' in r ? r : { type: 'swap_exercise', before: { slug: p.from }, after: { from: p.from, to: p.to }, reason: p.reason };
    }
    case 'adjust_calories': {
      const r = await checkCalories(sb, profile, p.delta_kcal, today, 'coach');
      return 'error' in r ? r : { type: 'calories', before: { surplus: r.current }, after: { surplus: r.next, delta: r.next - r.current }, reason: p.reason };
    }
    case 'reschedule_workout': {
      const r = await checkReschedule(sb, p.action, p.weekdays);
      return 'error' in r ? r : { type: 'reschedule_workout', before: r.before, after: { action: p.action, weekdays: r.weekdays }, reason: p.reason };
    }
    case 'add_note':
      return { type: 'add_note', before: null, after: { text: p.text.trim() }, reason: p.reason };
    case 'regenerate_meal': {
      const r = await checkMeal(sb, p.meal_id, today);
      return 'error' in r ? r : { type: 'regenerate_meal', before: { name: r.name }, after: { mealId: p.meal_id }, reason: p.reason };
    }
  }
}

type Block = NonNullable<Awaited<ReturnType<typeof loadActiveMeso>>>;

async function checkSwap(sb: SB, profile: Profile, from: string, to: string): Promise<Invalid | { block: Block }> {
  const block = await loadActiveMeso(sb);
  if (!block) return { error: 'no_block' };
  if (!block.days.some((d) => d.exercises.some((x) => x.slug === from))) return { error: 'not_in_program' };
  const [library, excluded] = await Promise.all([loadLibrary(), loadExcluded(sb)]);
  const e = library.find((x) => x.slug === from);
  if (!e) return { error: 'unknown_exercise' };
  const subs = substitutesFor(e, library, eligibilityFor(profile, excluded, block.meso.blockNo));
  if (!subs.some((x) => x.slug === to)) return { error: 'not_a_substitute' };
  return { block };
}

async function checkCalories(sb: SB, profile: Profile, delta: number, today: string, source: 'coach' | 'checkin'): Promise<Invalid | { current: number; next: number }> {
  const C = COACH.checkin;
  if (source === 'coach' && Math.abs(delta) > COACH.coach.calorieChangeMaxKcal) return { error: 'too_large' };
  const last = await lastCalorieChange(sb);
  if (last && toDay(today) - toDay(last) < C.minDaysBetweenChanges) return { error: 'recent_change' };
  const { data: user } = await sb.auth.getUser();
  const current = (await ensureTargets(sb, user.user!.id, profile, today)).surplus;
  const next = Math.min(C.surplusMaxKcal, Math.max(C.surplusMinKcal, current + delta));
  if (next === current) return { error: 'at_limit' };
  return { current, next };
}

async function checkReschedule(sb: SB, action: 'skip_next' | 'set_days', weekdays: readonly number[]): Promise<Invalid | { before: unknown; weekdays: number[] }> {
  const block = await loadActiveMeso(sb);
  if (!block) return { error: 'no_block' };
  if (action === 'skip_next') return { before: null, weekdays: [] as number[] };
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length !== block.meso.daysPerWeek || days.some((d) => d < 0 || d > 6)) return { error: 'wrong_days' };
  return { before: { weekdays: block.meso.trainingDays }, weekdays: days };
}

async function checkMeal(sb: SB, mealId: string, today: string): Promise<Invalid | { name: string }> {
  const plan = await loadPlan(sb, weekStartOf(today));
  const meal = plan?.status === 'ready' ? plan.meals.find((m) => m.id === mealId) : undefined;
  return meal ? { name: meal.nameFa } : { error: 'unknown_meal' };
}

/** Apply an approved adjustment. Returns null on success, or an error code (stored on the row). */
export async function applyAdjustment(sb: SB, userId: string, profile: Profile, a: AdjustmentRow, today: string): Promise<string | null> {
  switch (a.type) {
    case 'calories': {
      const r = await checkCalories(sb, profile, Number(a.after.delta), today, a.source);
      if ('error' in r) return r.error;
      await writeTargets(sb, userId, profile, today, r.next, a.source === 'checkin' ? 'weekly_adjustment' : 'manual');
      return null;
    }
    case 'swap_exercise': {
      const r = await checkSwap(sb, profile, a.after.from, a.after.to);
      if ('error' in r) return r.error;
      const dayIds = r.block.days.map((d) => d.id);
      const { error } = await sb.from('program_exercises').update({ slug: a.after.to, replaced_from: a.after.from })
        .in('program_day_id', dayIds).eq('slug', a.after.from);
      return error ? 'failed' : null;
    }
    case 'early_deload': {
      const block = await loadActiveMeso(sb);
      if (!block) return 'no_block';
      const wc = weekContext(mesoInfo(block.meso), profile.experience ?? 'none', today);
      if (wc.deload) return null; // already deloading
      const { error } = await sb.from('mesocycles').update({ deload_week: wc.week, early_deload_reason: a.after.reason }).eq('id', block.meso.id);
      return error ? 'failed' : null;
    }
    case 'reschedule_workout': {
      const r = await checkReschedule(sb, a.after.action, a.after.weekdays ?? []);
      if ('error' in r) return r.error;
      const block = (await loadActiveMeso(sb))!;
      if (a.after.action === 'skip_next') {
        const view = weekView(block.meso, block.days, await loadSessions(sb, block.meso.id), today);
        if (!view.state.next) return 'nothing_to_skip';
        const { error } = await sb.from('workout_sessions').insert({
          user_id: userId, mesocycle_id: block.meso.id, week: Math.max(1, view.weekNow), day_idx: view.state.next.dayIdx, date: today, status: 'skipped',
        });
        return error ? 'failed' : null;
      }
      const { error } = await sb.from('mesocycles').update({ training_days: r.weekdays }).eq('id', block.meso.id);
      if (error) return 'failed';
      if (block.meso.programId) await sb.from('programs').update({ preferred_days: r.weekdays }).eq('id', block.meso.programId);
      await sb.from('profile').update({ preferred_days: r.weekdays }).eq('user_id', userId);
      return null;
    }
    case 'add_note':
      return null;
    case 'regenerate_meal': {
      const r = await checkMeal(sb, a.after.mealId, today);
      if ('error' in r) return r.error;
      const { swapMeal } = await import('./nutritionActions');
      return (await swapMeal(a.after.mealId)).ok ? null : 'failed';
    }
  }
}
