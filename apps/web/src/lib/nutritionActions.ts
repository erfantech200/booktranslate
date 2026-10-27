'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  BudgetExceededError, dbCallHooks, InvalidModelOutputError, OpenAITransport, parseFoods, proposeSwap, saneNewFood, swapFromPlan,
  type ParsedItem, type PlanPrefs,
} from '@coach/core';
import { FOOD_CATEGORIES, itemsMacros, type Food, type PlanMeal } from '@coach/core/shared';
import { sanitizeLocalDate } from './format';
import { kickWorker } from './kick';
import { ensureTargets, foodMap, loadFoods, loadPlan, logRows, planDays, planFoods, weekStartOf } from './nutrition';
import { requireProfile } from './profile';
import type { Profile } from './profile';
import { localToday } from './today';

// Nutrition actions as the signed-in user (RLS). Every macro is computed here from the foods
// table; the browser and the model only ever send food ids and grams.

const done = () => revalidatePath('/', 'layout');
const deps = () => ({ transport: new OpenAITransport(), hooks: dbCallHooks });
const prefsOf = (p: Profile): PlanPrefs => ({
  cuisines: p.cuisines, dislikes: p.disliked_foods, allergies: p.allergies, rules: p.dietary_rules,
  cookingMinutes: p.cooking_minutes ?? 45, budget: p.budget ?? 'medium', appetite: p.appetite ?? 'normal',
});

// ─── Weekly plan ──────────────────────────────────────────────────────────────────────────
/** Start (or restart) this week's plan: a background job builds it; the page polls the status. */
export async function requestPlan(regenerate = false) {
  const { sb, user, profile } = await requireProfile();
  const today = await localToday();
  const target = await ensureTargets(sb, user.id, profile, today);
  const weekStart = weekStartOf(today);
  const existing = await loadPlan(sb, weekStart);
  if (existing && existing.status === 'pending') { await kickWorker(); return; }
  if (existing && existing.status === 'ready' && !regenerate) return;
  if (existing) await sb.from('meal_plans').delete().eq('id', existing.id);
  const { data: plan, error } = await sb.from('meal_plans').insert({ user_id: user.id, week_start: weekStart, target_id: target.id }).select('id').single();
  if (error || !plan) throw new Error(error?.message ?? 'plan insert failed');
  const { data: job } = await sb.from('jobs').insert({
    user_id: user.id, type: 'meal_plan', payload: { planId: plan.id }, dedupe_key: `meal_plan:${plan.id}`,
  }).select('id').single();
  if (job) await sb.from('meal_plans').update({ job_id: job.id }).eq('id', plan.id);
  await kickWorker();
  done();
}

/** Status for the polling page; gives a stuck queue another push. */
export async function planStatus(planId: string): Promise<'pending' | 'ready' | 'failed'> {
  const { sb } = await requireProfile();
  const { data: p } = await sb.from('meal_plans').select('status, job_id, created_at').eq('id', planId).maybeSingle();
  if (!p) return 'failed';
  if (p.status !== 'pending') return p.status;
  const { data: job } = p.job_id ? await sb.from('jobs').select('status, updated_at').eq('id', p.job_id).maybeSingle() : { data: null };
  if (job?.status === 'failed' || job?.status === 'cancelled') return 'failed';
  if (!job || job.status === 'queued') await kickWorker();
  return 'pending';
}

// ─── Eating as planned ────────────────────────────────────────────────────────────────────
export async function togglePlannedMeal(mealId: string, localDate: string, eaten: boolean) {
  const { sb, user } = await requireProfile();
  const date = sanitizeLocalDate(localDate);
  await sb.from('food_logs').delete().eq('meal_id', mealId).eq('date', date);
  if (eaten) {
    const { data: items } = await sb.from('meal_items').select('food_id, grams').eq('meal_id', mealId).order('idx');
    const foods = await foodMap();
    const { data: meal } = await sb.from('meals').select('name_fa').eq('id', mealId).maybeSingle();
    const rows = logRows({
      userId: user.id, date, entryId: randomUUID(), source: 'plan', mealId,
      items: (items ?? []).filter((i) => foods.has(i.food_id)).map((i) => ({ food: foods.get(i.food_id)!, grams: Number(i.grams), label: meal?.name_fa })),
    });
    if (rows.length) await sb.from('food_logs').insert(rows);
  }
  done();
}

/** One-tap swap: an alternative dish with the same calories and protein (spec §9). */
export async function swapMeal(mealId: string): Promise<{ ok: boolean; fallback?: boolean }> {
  const { sb, user, profile } = await requireProfile();
  const { data: m } = await sb.from('meals').select('id, plan_id, slot, name_fa, cook_minutes, meal_items(food_id, grams, idx)').eq('id', mealId).maybeSingle();
  if (!m) return { ok: false };
  const foods = planFoods(await loadFoods(), profile);
  const byId = new Map(foods.map((f) => [f.id, f]));
  const plan = (await sb.from('meal_plans').select('week_start').eq('id', m.plan_id).single()).data;
  const full = plan ? await loadPlan(sb, plan.week_start) : null;
  const meal: PlanMeal = {
    slot: m.slot, nameFa: m.name_fa, cookMinutes: m.cook_minutes,
    items: [...m.meal_items].sort((a: any, b: any) => a.idx - b.idx).map((i: any) => ({ food: i.food_id, grams: Number(i.grams) })),
  };
  const weight = (await ensureTargets(sb, user.id, profile, await localToday())).weightKg;
  let next: PlanMeal | null = null;
  let fallback = false;
  try {
    next = await proposeSwap(user.id, {
      meal, foods, prefs: prefsOf(profile), avoid: [...new Set(full?.meals.map((x) => x.nameFa) ?? [])], proteinPerMeal: Math.round(0.4 * weight),
    }, deps());
  } catch (err) {
    if (!(err instanceof BudgetExceededError || err instanceof InvalidModelOutputError)) console.error(JSON.stringify({ msg: 'meal swap failed', err: String(err) }));
    next = full ? swapFromPlan(meal, planDays(full), byId) : null;
    fallback = true;
  }
  if (!next) return { ok: false };
  const mm = itemsMacros(next.items, byId);
  await sb.from('meal_items').delete().eq('meal_id', mealId);
  await sb.from('meal_items').insert(next.items.map((it, idx) => ({ user_id: user.id, meal_id: mealId, idx, food_id: it.food, grams: it.grams })));
  await sb.from('meals').update({
    name_fa: next.nameFa, cook_minutes: next.cookMinutes, kcal: mm.kcal.toFixed(1), protein_g: mm.protein.toFixed(1), carbs_g: mm.carbs.toFixed(1),
    fat_g: mm.fat.toFixed(1), swapped_from: m.name_fa,
  }).eq('id', mealId);
  // Anything already logged for this meal was the old dish: drop it.
  await sb.from('food_logs').delete().eq('meal_id', mealId);
  done();
  return { ok: true, fallback };
}

// ─── Free-text and photo logging ──────────────────────────────────────────────────────────
export type { ParsedItem };
export type ParseResult = { ok: true; items: ParsedItem[]; note: string; names: Record<string, string> } | { ok: false; error: 'empty' | 'failed' };

async function parse(input: { text?: string; imageDataUrl?: string }): Promise<ParseResult> {
  const { user } = await requireProfile();
  const foods = await loadFoods();
  try {
    const r = await parseFoods(user.id, input, foods, deps());
    if (!r.items.length) return { ok: false, error: 'empty' };
    const byId = new Map(foods.map((f) => [f.id, f.nameFa]));
    return { ok: true, items: r.items, note: r.note, names: Object.fromEntries(r.items.filter((i) => i.foodId).map((i) => [i.foodId!, byId.get(i.foodId!) ?? ''])) };
  } catch (err) {
    console.error(JSON.stringify({ msg: 'food parse failed', err: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: 'failed' };
  }
}

export async function parseFoodText(text: string): Promise<ParseResult> {
  const t = text.trim().slice(0, 600);
  return t ? parse({ text: t }) : { ok: false, error: 'empty' };
}

/** The photo is resized and re-encoded in the browser (no EXIF), sent once, and never stored. */
export async function parseFoodPhoto(dataUrl: string): Promise<ParseResult> {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) || dataUrl.length > 1_400_000) return { ok: false, error: 'failed' };
  return parse({ imageDataUrl: dataUrl });
}

const NewFood = z.object({
  name_fa: z.string().min(1).max(60), name_en: z.string().max(60), category: z.enum(FOOD_CATEGORIES),
  kcal: z.number().min(0).max(900), protein: z.number().min(0).max(100), carbs: z.number().min(0).max(100), fat: z.number().min(0).max(100), fiber: z.number().min(0).max(60),
});
const SaveInput = z.object({
  date: z.string(),
  source: z.enum(['text', 'photo', 'manual']),
  items: z.array(z.object({
    foodId: z.string().max(80).nullable(),
    newFood: NewFood.nullable(),
    grams: z.number().min(1).max(3000),
    label: z.string().max(80).nullable(),
    estimated: z.boolean(),
  })).min(1).max(20),
});

/** Save a confirmed entry. New foods become the owner's own estimated foods. */
export async function saveFoodLog(raw: z.input<typeof SaveInput>): Promise<{ ok: boolean }> {
  const v = SaveInput.parse(raw);
  const { sb, user } = await requireProfile();
  const foods = await foodMap();
  const items: { food: Food; grams: number; label: string | null; estimated: boolean }[] = [];
  for (const it of v.items) {
    let food = it.foodId ? foods.get(it.foodId) : undefined;
    if (!food && it.newFood) {
      const n = saneNewFood(it.newFood);
      const slug = (n.name_en || 'food').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'food';
      const id = `ai-${slug}-${randomUUID().slice(0, 6)}`;
      const row = {
        id, user_id: user.id, name_fa: n.name_fa, name_en: n.name_en, category: n.category, kcal: n.kcal, protein_g: n.protein, carbs_g: n.carbs,
        fat_g: n.fat, fiber_g: n.fiber, estimated: true, source: 'ai',
      };
      const { error } = await sb.from('foods').insert(row);
      if (error) return { ok: false };
      food = { id, nameFa: n.name_fa, nameEn: n.name_en, category: n.category, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, fiber: n.fiber,
        unit: null, whole: false, vegFruit: false, proteinKind: null, carbKind: null, allergens: [], rawPerCooked: null, estimated: true };
    }
    if (!food) return { ok: false };
    items.push({ food, grams: it.grams, label: it.label, estimated: it.estimated || v.source === 'photo' });
  }
  const { error } = await sb.from('food_logs').insert(logRows({ userId: user.id, date: sanitizeLocalDate(v.date), entryId: randomUUID(), source: v.source, items }));
  if (error) return { ok: false };
  done();
  return { ok: true };
}

export async function deleteLogEntry(entryId: string) {
  const { sb } = await requireProfile();
  await sb.from('food_logs').delete().eq('entry_id', entryId);
  done();
}
