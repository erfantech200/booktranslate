import 'server-only';
import { cache } from 'react';
import { foodFromRow } from '@coach/core';
import {
  activityFactor, addDays, blockedFoods, computeTargets, macrosOf, movingAverage, weekday, ZERO, addMacros,
  type Food, type Macros, type MealSlot, type PlanDay,
} from '@coach/core/shared';
import type { Profile } from './profile';
import { supabaseServer } from './supabase/server';
import { loadWeighIns } from './weights';

// Nutrition data access as the signed-in user (RLS), plus the glue to the engine.

type SB = Awaited<ReturnType<typeof supabaseServer>>;

/** Seed foods + the owner's own estimated foods, once per request. */
export const loadFoods = cache(async (): Promise<Food[]> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.from('foods').select('*').order('category').order('id');
  if (error) throw new Error(error.message);
  return (data ?? []).map(foodFromRow);
});
export const foodMap = async () => new Map((await loadFoods()).map((f) => [f.id, f]));

/** Foods a plan or swap may use: no dislikes/allergies, no junk, no one-off logged foods. */
export function planFoods(foods: Food[], profile: Profile): Food[] {
  const blocked = blockedFoods(foods, [profile.disliked_foods, profile.allergies].filter(Boolean).join('، '));
  return foods.filter((f) => !blocked.has(f.id) && !f.id.startsWith('ai-') && f.id !== 'soft-drink' && f.id !== 'potato-chips');
}

/** Plan weeks start on Saturday (Persian week). */
export const weekStartOf = (date: string) => addDays(date, -weekday(date));

export interface TargetRow {
  id: string; effectiveFrom: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number; waterMl: number;
  bmr: number; tdee: number; factor: number; surplus: number; weightKg: number; reason: string;
}
const targetOf = (r: any): TargetRow => ({
  id: r.id, effectiveFrom: r.effective_from, kcal: r.kcal, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g, fiber: r.fiber_g,
  waterMl: r.water_ml, bmr: r.bmr, tdee: r.tdee, factor: Number(r.factor), surplus: r.surplus, weightKg: Number(r.weight_kg), reason: r.reason,
});

export async function currentWeightKg(sb: SB, profile: Profile): Promise<number> {
  const trend = movingAverage(await loadWeighIns(sb));
  return trend.at(-1)?.kg ?? profile.start_weight_kg ?? 70;
}

/**
 * The targets in force, created by the engine when missing. A new row is written when the profile
 * changes the activity factor or bodyweight moved ≥ 2 kg; the surplus carries over (the weekly
 * check-in in Phase 5 is what tunes it).
 */
export async function ensureTargets(sb: SB, userId: string, profile: Profile, today: string): Promise<TargetRow> {
  const { data: last } = await sb.from('nutrition_targets').select('*').order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const weightKg = Math.round((await currentWeightKg(sb, profile)) * 10) / 10;
  const age = Number(today.slice(0, 4)) - (profile.birth_year ?? 1995);
  const input = {
    sex: profile.sex ?? 'male', weightKg, heightCm: profile.height_cm ?? 175, age,
    activity: profile.daily_activity ?? 'light', trainingDays: profile.days_per_week ?? 3,
  } as const;
  const factor = Math.round(activityFactor(input.activity, input.trainingDays) * 1000) / 1000;
  let reason: 'initial' | 'profile' | 'weight' | null = null;
  if (!last) reason = 'initial';
  else if (Math.abs(Number(last.factor) - factor) > 0.0005) reason = 'profile';
  else if (Math.abs(Number(last.weight_kg) - weightKg) >= 2) reason = 'weight';
  if (!reason) return targetOf(last);
  const t = computeTargets({ ...input, surplusKcal: last?.surplus });
  const { data, error } = await sb.from('nutrition_targets').insert({
    user_id: userId, effective_from: today, kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat, fiber_g: t.fiber,
    water_ml: t.waterMl, bmr: t.bmr, tdee: t.tdee, factor: t.factor, surplus: t.surplus, weight_kg: weightKg, reason,
  }).select('*').single();
  if (error) throw new Error(error.message);
  return targetOf(data);
}

// ─── Plans ────────────────────────────────────────────────────────────────────────────────
export interface MealRow {
  id: string; dayIdx: number; idx: number; slot: MealSlot; nameFa: string; cookMinutes: number;
  kcal: number; protein: number; carbs: number; fat: number; swappedFrom: string | null;
  items: { id: string; food: string; grams: number }[];
}
export interface PlanRow {
  id: string; weekStart: string; status: 'pending' | 'ready' | 'failed'; error: string | null; warnings: string[]; jobId: string | null;
  createdAt: string; meals: MealRow[];
}

export async function loadPlan(sb: SB, weekStart: string): Promise<PlanRow | null> {
  const { data: p } = await sb.from('meal_plans').select('*').eq('week_start', weekStart).maybeSingle();
  if (!p) return null;
  const { data: meals } = await sb.from('meals')
    .select('id, day_idx, idx, slot, name_fa, cook_minutes, kcal, protein_g, carbs_g, fat_g, swapped_from, meal_items(id, idx, food_id, grams)')
    .eq('plan_id', p.id).order('day_idx').order('idx');
  return {
    id: p.id, weekStart: p.week_start, status: p.status, error: p.error, warnings: p.warnings ?? [], jobId: p.job_id, createdAt: p.created_at,
    meals: (meals ?? []).map((m: any) => ({
      id: m.id, dayIdx: m.day_idx, idx: m.idx, slot: m.slot, nameFa: m.name_fa, cookMinutes: m.cook_minutes,
      kcal: Number(m.kcal), protein: Number(m.protein_g), carbs: Number(m.carbs_g), fat: Number(m.fat_g), swappedFrom: m.swapped_from,
      items: [...m.meal_items].sort((a: any, b: any) => a.idx - b.idx).map((i: any) => ({ id: i.id, food: i.food_id, grams: Number(i.grams) })),
    })),
  };
}

export const planDays = (plan: PlanRow): PlanDay[] =>
  Array.from({ length: 7 }, (_, d) => plan.meals.filter((m) => m.dayIdx === d).map((m) => ({
    slot: m.slot, nameFa: m.nameFa, cookMinutes: m.cookMinutes, items: m.items.map((i) => ({ food: i.food, grams: i.grams })),
  })));

// ─── Food log ─────────────────────────────────────────────────────────────────────────────
export interface LogRow {
  id: string; entryId: string; mealId: string | null; source: string; food: string; grams: number; label: string | null;
  estimated: boolean; loggedAt: string; macros: Macros;
}

export async function loadDayLogs(sb: SB, date: string): Promise<LogRow[]> {
  const { data } = await sb.from('food_logs').select('*').eq('date', date).order('logged_at');
  return (data ?? []).map((r) => ({
    id: r.id, entryId: r.entry_id, mealId: r.meal_id, source: r.source, food: r.food_id, grams: Number(r.grams), label: r.label,
    estimated: r.estimated, loggedAt: r.logged_at,
    macros: { kcal: Number(r.kcal), protein: Number(r.protein_g), carbs: Number(r.carbs_g), fat: Number(r.fat_g), fiber: Number(r.fiber_g) },
  }));
}

export const sumLogs = (logs: LogRow[]) => logs.reduce((m, l) => addMacros(m, l.macros), ZERO);

/** Rows for food_logs, macros computed here from the foods table (never from the client). */
export function logRows(o: {
  userId: string; date: string; entryId: string; source: 'plan' | 'text' | 'photo' | 'manual'; mealId?: string | null;
  items: { food: Food; grams: number; label?: string | null; estimated?: boolean }[];
}) {
  return o.items.map((it) => {
    const m = macrosOf(it.food, it.grams);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      user_id: o.userId, date: o.date, entry_id: o.entryId, meal_id: o.mealId ?? null, source: o.source, food_id: it.food.id, grams: r1(it.grams),
      kcal: r1(m.kcal), protein_g: r1(m.protein), carbs_g: r1(m.carbs), fat_g: r1(m.fat), fiber_g: r1(m.fiber),
      estimated: !!it.estimated || it.food.estimated, label: it.label ?? null, logged_at: new Date().toISOString(),
    };
  });
}
