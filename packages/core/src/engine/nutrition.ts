import { COACH } from '../coach.config';

// Nutrition engine (spec §9): targets, macros of foods and meals, and the portion scaler that
// makes an LLM-proposed day hit the targets. The LLM picks foods; every number comes from here.

const N = COACH.nutrition;

export const FOOD_CATEGORIES = [
  'grains', 'legumes', 'meat_fish', 'dairy_eggs', 'nuts_seeds', 'fats_oils', 'vegetables', 'fruits', 'pantry', 'drinks', 'supplements',
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];
export const PROTEIN_KINDS = ['chicken', 'turkey', 'beef', 'lamb', 'fish', 'seafood', 'egg', 'dairy', 'whey', 'legume', 'soy', 'offal'] as const;
export type ProteinKind = (typeof PROTEIN_KINDS)[number];
export const CARB_KINDS = ['rice', 'bread', 'potato', 'oats', 'pasta', 'bulgur', 'other_grain'] as const;
export type CarbKind = (typeof CARB_KINDS)[number];
export const ALLERGENS = ['dairy', 'egg', 'gluten', 'peanut', 'tree_nut', 'fish', 'shellfish', 'soy', 'sesame'] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Macros per 100 g. */
export interface Food {
  id: string;
  nameFa: string;
  nameEn: string;
  category: FoodCategory;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** A household unit ("یک عدد", "یک قاشق"), grams per unit. */
  unit: { fa: string; g: number } | null;
  /** Counted and planned in whole units (eggs, a banana). */
  whole: boolean;
  /** Counts toward vegetable/fruit servings. */
  vegFruit: boolean;
  proteinKind: ProteinKind | null;
  carbKind: CarbKind | null;
  allergens: Allergen[];
  /** Raw (shopping) grams per gram as eaten, for cooked foods (rice, meat, legumes). */
  rawPerCooked: number | null;
  /** Macros are an estimate (composite or poorly documented foods, or written by the LLM). */
  estimated: boolean;
}

export interface Macros { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
export const addMacros = (a: Macros, b: Macros): Macros => ({
  kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat, fiber: a.fiber + b.fiber,
});
export const macrosOf = (f: Pick<Food, 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber'>, grams: number): Macros => ({
  kcal: (f.kcal * grams) / 100, protein: (f.protein * grams) / 100, carbs: (f.carbs * grams) / 100, fat: (f.fat * grams) / 100, fiber: (f.fiber * grams) / 100,
});
export const roundMacros = (m: Macros): Macros => ({
  kcal: Math.round(m.kcal), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat), fiber: Math.round(m.fiber),
});

// ─── Targets ──────────────────────────────────────────────────────────────────────────────
export type Sex = 'male' | 'female';
export type DailyActivity = 'sedentary' | 'light' | 'active';

/** Mifflin-St Jeor resting energy (kcal/day). */
export const bmr = (sex: Sex, weightKg: number, heightCm: number, age: number) =>
  10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);

export function activityFactor(activity: DailyActivity, trainingDays: number): number {
  const f = N.activityBase[activity] + N.perTrainingDay * trainingDays;
  return Math.min(N.activityMax, Math.max(N.activityMin, f));
}

export interface TargetInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activity: DailyActivity;
  trainingDays: number;
  /** Extra kcal on top of TDEE; defaults to the starting surplus. */
  surplusKcal?: number;
}

export interface Targets {
  bmr: number;
  tdee: number;
  factor: number;
  surplus: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
  waterTrainingMl: number;
  proteinPerMeal: number;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export function computeTargets(i: TargetInput): Targets {
  const b = bmr(i.sex, i.weightKg, i.heightCm, i.age);
  const factor = activityFactor(i.activity, i.trainingDays);
  const tdee = b * factor;
  const surplus = i.surplusKcal ?? N.surplusKcal;
  const kcal = roundTo(tdee + surplus, N.kcalRounding);
  const protein = Math.round(N.proteinGPerKg * i.weightKg);
  // Fat: 0.9 g/kg, but never under 20 % of energy and inside 0.8–1.0 g/kg unless 20 % needs more.
  const floor = (kcal * N.fatMinPctKcal) / 100 / 9;
  const fat = Math.round(Math.max(floor, Math.min(N.fatRangeGPerKg[1] * i.weightKg, Math.max(N.fatRangeGPerKg[0] * i.weightKg, N.fatGPerKg * i.weightKg))));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    bmr: Math.round(b),
    tdee: Math.round(tdee),
    factor: Math.round(factor * 1000) / 1000,
    surplus,
    kcal,
    protein,
    carbs,
    fat,
    fiber: Math.round((N.fiberGPer1000Kcal * kcal) / 1000),
    waterMl: roundTo(N.waterMlPerKg * i.weightKg, 50),
    waterTrainingMl: N.waterTrainingMl,
    proteinPerMeal: Math.round(N.proteinPerMealGPerKg * i.weightKg),
  };
}

// ─── Meal slots ───────────────────────────────────────────────────────────────────────────
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'shake'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MAIN_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/**
 * Meal slots for the day, in eating order. A low or normal appetite gets the daily shake (an
 * easy 500–700 kcal: milk + oats + banana + peanut butter) as one of the snacks (spec §9).
 */
export function mealSlots(mealsPerDay: number, appetite: 'low' | 'normal' | 'high'): MealSlot[] {
  const extra = Math.min(6, Math.max(3, mealsPerDay)) - 3;
  const out: MealSlot[] = ['breakfast'];
  if (extra >= 2) out.push('snack'); // mid-morning
  out.push('lunch');
  if (extra >= 1) out.push(appetite === 'high' ? 'snack' : 'shake'); // afternoon
  out.push('dinner');
  if (extra >= 3) out.push('snack'); // evening
  return out;
}

/** Guide kcal per slot (the plan's scaler has the final word). */
export function slotKcal(slots: readonly MealSlot[], kcal: number): number[] {
  const w = slots.map((s) => N.plan.slotShare[s]);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => roundTo((kcal * x) / sum, 10));
}

// ─── Plan days: macros, scaling, variety ──────────────────────────────────────────────────
export interface PlanItem { food: string; grams: number }
export interface PlanMeal { slot: MealSlot; nameFa: string; cookMinutes: number; items: PlanItem[] }
export type PlanDay = PlanMeal[];

export const itemsMacros = (items: readonly PlanItem[], foods: ReadonlyMap<string, Food>): Macros =>
  items.reduce((m, it) => {
    const f = foods.get(it.food);
    return f ? addMacros(m, macrosOf(f, it.grams)) : m;
  }, ZERO);

export const dayMacros = (day: PlanDay, foods: ReadonlyMap<string, Food>) =>
  day.reduce((m, meal) => addMacros(m, itemsMacros(meal.items, foods)), ZERO);

/** Round grams to what can be measured: whole units, else 5 g (oils and nuts: 5 g too). */
export function roundGrams(f: Food, grams: number): number {
  if (f.whole && f.unit) return Math.max(1, Math.round(grams / f.unit.g)) * f.unit.g;
  return Math.max(5, Math.round(grams / 5) * 5);
}

const step = (f: Food, grams: number) => (f.whole && f.unit ? f.unit.g : Math.max(5, Math.round((grams * 0.1) / 5) * 5));

/** Grams of protein per kcal: how "protein-dense" a food is. */
const proteinDensity = (f: Food) => (f.kcal > 0 ? f.protein / f.kcal : 0);
const isProteinFood = (f: Food) => f.kcal > 0 && (f.protein * 4) / f.kcal >= 0.3;

export interface ScaleResult {
  day: PlanDay;
  macros: Macros;
  /** Within ±kcalTolerancePct kcal and ±proteinTolerancePct protein. */
  ok: boolean;
}

export const withinTargets = (m: Macros, t: { kcal: number; protein: number }) =>
  Math.abs(m.kcal - t.kcal) <= (t.kcal * N.plan.kcalTolerancePct) / 100
  && Math.abs(m.protein - t.protein) <= (t.protein * N.plan.proteinTolerancePct) / 100;

/**
 * Scale one day's portions so it lands within ±5 % kcal and ±10 % protein of target (spec §9),
 * with main meals reaching the per-meal protein minimum where possible. Portions stay between
 * half and double of what was proposed. Deterministic: same input, same output.
 */
export function scaleDay(day: PlanDay, foods: ReadonlyMap<string, Food>, t: { kcal: number; protein: number; proteinPerMeal?: number }): ScaleResult {
  const P = N.plan;
  type Slot = { mi: number; ii: number; f: Food; orig: number; g: number };
  const flat: Slot[] = [];
  day.forEach((meal, mi) => meal.items.forEach((it, ii) => {
    const f = foods.get(it.food);
    if (f && it.grams > 0) flat.push({ mi, ii, f, orig: it.grams, g: it.grams });
  }));
  const min = (s: Slot) => Math.max(s.f.whole && s.f.unit ? s.f.unit.g : 5, s.orig * P.scaleMin);
  const max = (s: Slot) => s.orig * P.scaleMax;
  const total = () => flat.reduce((m, s) => addMacros(m, macrosOf(s.f, s.g)), ZERO);
  const mealProtein = (mi: number) => flat.filter((s) => s.mi === mi).reduce((p, s) => p + (s.f.protein * s.g) / 100, 0);

  // 1. One factor for the whole day toward the kcal target.
  const k0 = total().kcal;
  if (k0 > 0) {
    const f = Math.min(P.scaleMax, Math.max(P.scaleMin, t.kcal / k0));
    for (const s of flat) s.g = Math.min(max(s), Math.max(min(s), s.g * f));
  }
  for (const s of flat) s.g = roundGrams(s.f, s.g);

  // 2. Nudge single items until both targets are met (or nothing can move).
  const nudge = (cands: Slot[], dir: 1 | -1, by: (s: Slot) => number) => {
    const ok = cands.filter((s) => (dir > 0 ? s.g + step(s.f, s.g) <= max(s) + 1e-9 : s.g - step(s.f, s.g) >= min(s) - 1e-9));
    ok.sort((a, b) => by(b) - by(a) || a.mi - b.mi || a.ii - b.ii);
    const s = ok[0];
    if (!s) return false;
    s.g = roundGrams(s.f, s.g + dir * step(s.f, s.g));
    return true;
  };
  const pLo = t.protein * (1 - P.proteinTolerancePct / 100), pHi = t.protein * (1 + P.proteinTolerancePct / 100);
  const kLo = t.kcal * (1 - P.kcalTolerancePct / 100), kHi = t.kcal * (1 + P.kcalTolerancePct / 100);
  const mains = day.map((m, mi) => (MAIN_SLOTS.includes(m.slot) ? mi : -1)).filter((mi) => mi >= 0);
  for (let guard = 0; guard < 400; guard++) {
    const m = total();
    // Per-meal protein first (only while the day can take more protein).
    const lowMeal = t.proteinPerMeal ? mains.find((mi) => mealProtein(mi) < t.proteinPerMeal! - 0.5) : undefined;
    if (lowMeal != null && m.protein < pHi && nudge(flat.filter((s) => s.mi === lowMeal && isProteinFood(s.f)), 1, (s) => proteinDensity(s.f))) continue;
    if (m.protein < pLo) { if (nudge(flat.filter((s) => isProteinFood(s.f)), 1, (s) => proteinDensity(s.f))) continue; }
    else if (m.protein > pHi) { if (nudge(flat.filter((s) => isProteinFood(s.f)), -1, (s) => proteinDensity(s.f))) continue; }
    if (m.kcal < kLo) { if (nudge(flat.filter((s) => !isProteinFood(s.f)), 1, (s) => s.f.kcal)) continue; }
    else if (m.kcal > kHi) { if (nudge(flat.filter((s) => !isProteinFood(s.f)), -1, (s) => (s.f.kcal * s.g) / 100)) continue; }
    break;
  }

  const out: PlanDay = day.map((meal, mi) => ({
    ...meal,
    items: meal.items.map((it, ii) => {
      const s = flat.find((x) => x.mi === mi && x.ii === ii);
      return s ? { food: it.food, grams: s.g } : it;
    }),
  }));
  const macros = dayMacros(out, foods);
  return { day: out, macros, ok: withinTargets(macros, t) };
}

/** Scale a single meal toward a kcal/protein goal (used for swaps: same macros as the meal it replaces). */
export function scaleMeal(meal: PlanMeal, foods: ReadonlyMap<string, Food>, goal: { kcal: number; protein: number }): PlanMeal {
  return scaleDay([meal], foods, goal).day[0]!;
}

export function vegFruitServings(day: PlanDay, foods: ReadonlyMap<string, Food>): number {
  const g = day.flatMap((m) => m.items).reduce((s, it) => s + (foods.get(it.food)?.vegFruit ? it.grams : 0), 0);
  return g / N.plan.vegFruitServingG;
}

/**
 * Top a day up to the minimum vegetable/fruit servings: a fruit with a snack (or breakfast) and
 * a side salad with lunch/dinner. Uses the plan's own produce where possible.
 */
export function ensureVegFruit(day: PlanDay, foods: ReadonlyMap<string, Food>, pick: { fruit: string; salad: string[] }): PlanDay {
  const need = () => N.plan.minVegFruitServingsPerDay - vegFruitServings(out, foods);
  const out = day.map((m) => ({ ...m, items: [...m.items] }));
  const add = (slots: MealSlot[], food: string, grams: number) => {
    const meal = out.find((m) => slots.includes(m.slot) && !m.items.some((i) => i.food === food)) ?? out.find((m) => slots.includes(m.slot));
    if (!meal) return false;
    const hit = meal.items.find((i) => i.food === food);
    if (hit) hit.grams += grams;
    else meal.items.push({ food, grams });
    return true;
  };
  for (let guard = 0; guard < 6 && need() > 0.05; guard++) {
    const fruit = foods.get(pick.fruit);
    if (fruit && need() > 0.05 && add(['snack', 'breakfast', 'shake'], pick.fruit, roundGrams(fruit, fruit.unit?.g ?? 120))) continue;
    let added = false;
    for (const s of pick.salad) if (foods.get(s) && add(['lunch', 'dinner'], s, 80)) added = true;
    if (!added) break;
  }
  return out;
}

// ─── Variety rules (spec §9) ──────────────────────────────────────────────────────────────
export interface VarietyIssue { rule: 'same_meal' | 'protein_sources' | 'carb_sources' | 'veg_fruit'; detail: string }

const mealKey = (m: PlanMeal) => m.items.map((i) => i.food).sort().join('+');

export function varietyIssues(week: readonly PlanDay[], foods: ReadonlyMap<string, Food>): VarietyIssue[] {
  const out: VarietyIssue[] = [];
  const counts = new Map<string, { n: number; name: string }>();
  for (const day of week) for (const m of day) {
    // A lone fruit or glass of milk may repeat, and so may the daily shake (spec §9).
    if (m.items.length < 2 || m.slot === 'shake') continue;
    const k = mealKey(m);
    const c = counts.get(k) ?? { n: 0, name: m.nameFa };
    counts.set(k, { n: c.n + 1, name: c.name });
  }
  for (const { n, name } of counts.values()) if (n > N.plan.maxSameMealPerWeek) out.push({ rule: 'same_meal', detail: `"${name}" appears ${n} times` });
  const items = week.flat().flatMap((m) => m.items);
  const proteins = new Set(items.filter((i) => i.grams >= 30).map((i) => foods.get(i.food)?.proteinKind).filter(Boolean));
  if (proteins.size < N.plan.minProteinSourcesPerWeek) out.push({ rule: 'protein_sources', detail: `${proteins.size} protein sources (${[...proteins].join(', ')})` });
  const carbs = new Set(items.map((i) => foods.get(i.food)?.carbKind).filter(Boolean));
  if (carbs.size < N.plan.minCarbSourcesPerWeek) out.push({ rule: 'carb_sources', detail: `${carbs.size} carb sources (${[...carbs].join(', ')})` });
  week.forEach((day, i) => {
    const s = vegFruitServings(day, foods);
    if (s < N.plan.minVegFruitServingsPerDay - 0.05) out.push({ rule: 'veg_fruit', detail: `day ${i + 1}: ${s.toFixed(1)} servings` });
  });
  return out;
}

/** Foods matching a disliked word or an allergy (free text from the profile, any language). */
export function blockedFoods(foods: readonly Food[], text: string | null | undefined): Set<string> {
  const words = (text ?? '').split(/[,،؛;\n/]+| و /).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
  const out = new Set<string>();
  for (const f of foods) {
    const names = `${f.nameFa} ${f.nameEn}`.toLowerCase();
    if (words.some((w) => names.includes(w) || ALLERGEN_WORDS[w]?.some((a) => f.allergens.includes(a)))) out.add(f.id);
  }
  return out;
}

/** Common Persian and English words for allergens/intolerances → allergen tags. */
const ALLERGEN_WORDS: Record<string, Allergen[]> = {
  'لاکتوز': ['dairy'], 'لبنیات': ['dairy'], 'شیر': ['dairy'], lactose: ['dairy'], dairy: ['dairy'], milk: ['dairy'],
  'تخم‌مرغ': ['egg'], 'تخم مرغ': ['egg'], egg: ['egg'], eggs: ['egg'],
  'گلوتن': ['gluten'], 'گندم': ['gluten'], gluten: ['gluten'], wheat: ['gluten'], celiac: ['gluten'], 'سلیاک': ['gluten'],
  'بادام زمینی': ['peanut'], 'بادام‌زمینی': ['peanut'], peanut: ['peanut'], peanuts: ['peanut'],
  'آجیل': ['tree_nut'], 'مغزها': ['tree_nut'], nuts: ['tree_nut'], 'tree nuts': ['tree_nut'],
  'ماهی': ['fish'], fish: ['fish'], 'میگو': ['shellfish'], 'صدف': ['shellfish'], shellfish: ['shellfish'], shrimp: ['shellfish'],
  'سویا': ['soy'], soy: ['soy'], 'کنجد': ['sesame'], sesame: ['sesame'],
};

// ─── Grocery list ─────────────────────────────────────────────────────────────────────────
export interface GroceryLine { food: string; category: FoodCategory; grams: number; units: number | null }

/** The week's shopping in raw amounts (cooked rice → raw rice), grouped by category. */
export function groceryList(week: readonly PlanDay[], foods: ReadonlyMap<string, Food>): GroceryLine[] {
  const g = new Map<string, number>();
  for (const it of week.flat().flatMap((m) => m.items)) g.set(it.food, (g.get(it.food) ?? 0) + it.grams);
  const lines: GroceryLine[] = [];
  for (const [id, grams] of g) {
    const f = foods.get(id);
    if (!f) continue;
    const raw = grams * (f.rawPerCooked ?? 1);
    lines.push({
      food: id,
      category: f.category,
      grams: raw >= 1000 ? Math.ceil(raw / 50) * 50 : Math.ceil(raw / 10) * 10,
      units: f.whole && f.unit ? Math.ceil(grams / f.unit.g) : null,
    });
  }
  return lines.sort((a, b) => FOOD_CATEGORIES.indexOf(a.category) - FOOD_CATEGORIES.indexOf(b.category) || b.grams - a.grams);
}
