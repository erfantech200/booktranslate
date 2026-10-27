import { z } from 'zod';
import { COACH } from '../coach.config';
import { textModel } from '../config';
import {
  dayMacros, ensureVegFruit, MAIN_SLOTS, MEAL_SLOTS, scaleDay, scaleMeal, varietyIssues, vegFruitServings,
  type Food, type MealSlot, type PlanDay, type PlanMeal,
} from '../engine/nutrition';
import { structuredCall, type CallHooks, type ModelTransport } from '../openai/structured';

// Weekly meal plan (spec §9). The LLM picks dishes and ingredients from the food catalogue;
// the code computes every macro, scales portions to the targets and fixes produce servings.
// The model's own numbers are never asked for and never trusted.

const P = COACH.nutrition.plan;

export interface PlanPrefs {
  cuisines: string[];
  dislikes: string | null;
  allergies: string | null;
  rules: string | null;
  cookingMinutes: number;
  budget: 'low' | 'medium' | 'high';
  appetite: 'low' | 'normal' | 'high';
}

export interface PlanRequest {
  prefs: PlanPrefs;
  targets: { kcal: number; protein: number; proteinPerMeal: number };
  slots: MealSlot[];
  slotKcal: number[];
  /** Foods the owner may eat (dislikes and allergies already removed). */
  foods: Food[];
  /** Dish names from last week, to vary from. */
  recent?: string[];
}

const mealSchema = (ids: [string, ...string[]]) => z.object({
  slot: z.enum(MEAL_SLOTS),
  name_fa: z.string().min(2).max(80),
  cook_minutes: z.number().int().min(0).max(240),
  items: z.array(z.object({ food: z.enum(ids), grams: z.number().min(1).max(1500) })).min(1).max(9),
});

export const catalogue = (foods: readonly Food[]) =>
  foods.map((f) => `${f.id} | ${f.nameFa} | ${Math.round(f.kcal)} kcal, ${f.protein} g protein per 100 g${f.unit ? ` | 1 ${f.unit.fa} ≈ ${f.unit.g} g` : ''}`).join('\n');

const SLOT_FA: Record<MealSlot, string> = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام', snack: 'میان‌وعده', shake: 'شیک' };

export const MEAL_PLAN_INSTRUCTIONS = `You plan meals for a private Persian strength-training app. The owner is trying to gain muscle.
Return 7 days of meals as JSON. Write dish names in natural Persian.

Food rules:
- Use ONLY foods from the catalogue (by id). Grams are as eaten: cooked weight for rice, pasta, meat, fish and legumes.
- Decompose every dish into catalogue ingredients, including the cooking oil or butter (e.g. قورمه سبزی = beef stew meat + kidney beans + ghormeh herbs + onion + oil; serve with cooked rice).
- Each breakfast, lunch and dinner has a clear protein source providing at least the per-meal protein minimum.
- Respect the cuisines, dislikes, allergies, dietary rules, cooking time per day and budget given. Mostly simple home cooking; reuse leftovers (cook once, eat twice) to save time.
- A "shake" slot is a blender drink, e.g. milk + oats + banana + peanut butter, varied through the week.
- Snacks are easy and calorie-dense when appetite is low or normal (nuts, dates, yogurt, bread with cheese, fruit).

Variety rules (checked by code):
- No identical meal (same ingredients) more than ${P.maxSameMealPerWeek} times in the week.
- At least ${P.minProteinSourcesPerWeek} different protein sources across the week (chicken, beef, lamb, fish, eggs, dairy, legumes …).
- At least ${P.minCarbSourcesPerWeek} different carb sources (rice, bread, potatoes, oats, pasta, bulgur …), rotated.
- Plenty of vegetables and fruit every day (salad, herbs, fruit with snacks).

Portions: aim near the guide calories per slot; the app rescales every portion exactly afterwards.
Do not state calories or macros anywhere; the app computes them.`;

function planInput(r: PlanRequest) {
  return [
    `Targets per day (the app scales portions to these): about ${r.targets.kcal} kcal, ${r.targets.protein} g protein. Per-meal protein minimum: ${r.targets.proteinPerMeal} g.`,
    `Meals each day, in order: ${r.slots.map((s, i) => `${s} (${SLOT_FA[s]}, guide ≈ ${r.slotKcal[i]} kcal)`).join(', ')}.`,
    `Cuisines liked: ${r.prefs.cuisines.join(', ') || 'persian'}. Dislikes: ${r.prefs.dislikes || 'none'}. Allergies/intolerances: ${r.prefs.allergies || 'none'}.`,
    `Dietary rules: ${r.prefs.rules || 'none'}. Cooking time per day: about ${r.prefs.cookingMinutes} minutes. Budget: ${r.prefs.budget}. Appetite: ${r.prefs.appetite}.`,
    r.recent?.length ? `Last week's dishes (vary from these): ${r.recent.join('، ')}.` : '',
    '',
    'Food catalogue (id | Persian name | per 100 g):',
    catalogue(r.foods),
  ].filter((l) => l !== '').join('\n');
}

const toMeal = (m: { slot: MealSlot; name_fa: string; cook_minutes: number; items: { food: string; grams: number }[] }): PlanMeal => ({
  slot: m.slot, nameFa: m.name_fa.trim(), cookMinutes: m.cook_minutes, items: m.items.map((i) => ({ food: i.food, grams: i.grams })),
});

export interface Deps { transport: ModelTransport; hooks: CallHooks }

/** Ask the model for a week; validated for shape, slot order and variety (one corrective retry). */
export async function proposeWeek(userId: string, r: PlanRequest, deps: Deps): Promise<PlanDay[]> {
  const ids = r.foods.map((f) => f.id) as [string, ...string[]];
  const byId = new Map(r.foods.map((f) => [f.id, f]));
  const Schema = z.object({ days: z.array(z.object({ meals: z.array(mealSchema(ids)).min(3).max(6) })).length(7) });
  const { model, effort } = textModel();
  const { value } = await structuredCall({
    transport: deps.transport,
    hooks: deps.hooks,
    ctx: { userId, feature: 'meal_plan' },
    model,
    effort,
    schema: Schema,
    schemaName: 'meal_plan',
    instructions: MEAL_PLAN_INSTRUCTIONS,
    input: [{ role: 'user', content: planInput(r) }],
    maxOutputTokens: 30_000,
    cacheKey: 'meal_plan_v1',
    check: (v) => {
      for (const [i, d] of v.days.entries()) {
        const slots = d.meals.map((m) => m.slot).join(',');
        if (slots !== r.slots.join(',')) return `day ${i + 1} has meals ${slots}; it must have exactly ${r.slots.join(',')} in that order`;
      }
      const week = v.days.map((d) => d.meals.map(toMeal));
      const issues = varietyIssues(week, byId).filter((x) => x.rule !== 'veg_fruit');
      return issues.length ? `variety rules broken: ${issues.map((x) => `${x.rule} (${x.detail})`).join('; ')}` : null;
    },
  });
  return value.days.map((d) => d.meals.map(toMeal));
}

export interface FinishedWeek { days: PlanDay[]; warnings: string[] }

/** Produce top-up and portion scaling for every day (deterministic). */
export function finishWeek(week: PlanDay[], r: Pick<PlanRequest, 'foods' | 'targets'>): FinishedWeek {
  const byId = new Map(r.foods.map((f) => [f.id, f]));
  const fruits = week.flat().flatMap((m) => m.items).map((i) => byId.get(i.food)).filter((f): f is Food => !!f && f.category === 'fruits' && f.vegFruit && f.kcal < 120);
  const counts = new Map<string, number>();
  for (const f of fruits) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
  const fruit = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ['apple', 'orange', 'banana', 'tangerine'].find((id) => byId.has(id)) ?? '';
  const salad = ['cucumber', 'tomato', 'lettuce', 'carrot'].filter((id) => byId.has(id));
  const warnings: string[] = [];
  const days = week.map((day, i) => {
    let d = scaleDay(day, byId, r.targets).day;
    d = ensureVegFruit(d, byId, { fruit, salad });
    const res = scaleDay(d, byId, r.targets);
    if (!res.ok) warnings.push(`day ${i + 1}: ${Math.round(res.macros.kcal)} kcal / ${Math.round(res.macros.protein)} g protein after scaling`);
    if (vegFruitServings(res.day, byId) < P.minVegFruitServingsPerDay - 0.05) warnings.push(`day ${i + 1}: fewer than ${P.minVegFruitServingsPerDay} produce servings`);
    return res.day;
  });
  return { days, warnings };
}

// ─── Swap one meal ────────────────────────────────────────────────────────────────────────
export async function proposeSwap(userId: string, o: {
  meal: PlanMeal; foods: Food[]; prefs: PlanPrefs; avoid: string[]; proteinPerMeal: number;
}, deps: Deps): Promise<PlanMeal> {
  const ids = o.foods.map((f) => f.id) as [string, ...string[]];
  const byId = new Map(o.foods.map((f) => [f.id, f]));
  const goal = dayMacros([o.meal], byId);
  const Schema = z.object({ meal: mealSchema(ids) });
  const { model, effort } = textModel();
  const { value } = await structuredCall({
    transport: deps.transport,
    hooks: deps.hooks,
    ctx: { userId, feature: 'meal_swap' },
    model,
    effort,
    schema: Schema,
    schemaName: 'meal_swap',
    instructions: `${MEAL_PLAN_INSTRUCTIONS}\n\nNow return ONE alternative for a single meal: the same slot, a different dish, similar calories and protein.`,
    input: [{
      role: 'user',
      content: [
        `Replace this ${o.meal.slot} (${SLOT_FA[o.meal.slot]}): ${o.meal.nameFa} — ${o.meal.items.map((i) => `${byId.get(i.food)?.nameFa ?? i.food} ${i.grams} g`).join('، ')}.`,
        `It has about ${Math.round(goal.kcal)} kcal and ${Math.round(goal.protein)} g protein.${MAIN_SLOTS.includes(o.meal.slot) ? ` Per-meal protein minimum: ${o.proteinPerMeal} g.` : ''}`,
        `Do not repeat these dishes from this week: ${o.avoid.join('، ') || 'none'}.`,
        `Cuisines: ${o.prefs.cuisines.join(', ')}. Dislikes: ${o.prefs.dislikes || 'none'}. Allergies: ${o.prefs.allergies || 'none'}. Rules: ${o.prefs.rules || 'none'}. Budget: ${o.prefs.budget}.`,
        '',
        'Food catalogue (id | Persian name | per 100 g):',
        catalogue(o.foods),
      ].join('\n'),
    }],
    maxOutputTokens: 6000,
    cacheKey: 'meal_swap_v1',
    check: (v) => (v.meal.slot !== o.meal.slot ? `slot must be ${o.meal.slot}` : v.meal.name_fa.trim() === o.meal.nameFa ? 'propose a different dish' : null),
  });
  return scaleMeal(toMeal(value.meal), byId, { kcal: goal.kcal, protein: goal.protein });
}

/** Offline fallback for a swap: the same slot from another day of the plan, scaled to this meal. */
export function swapFromPlan(meal: PlanMeal, week: readonly PlanDay[], foods: ReadonlyMap<string, Food>): PlanMeal | null {
  const goal = dayMacros([meal], foods);
  const key = (m: PlanMeal) => m.items.map((i) => i.food).sort().join('+');
  const other = week.flat().find((m) => m.slot === meal.slot && key(m) !== key(meal) && m.nameFa !== meal.nameFa);
  return other ? scaleMeal({ ...other, items: other.items.map((i) => ({ ...i })) }, foods, { kcal: goal.kcal, protein: goal.protein }) : null;
}
