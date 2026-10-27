import { describe, expect, it } from 'vitest';
import { COACH } from '../src/coach.config';
import { FOODS } from '../src/data/foods';
import {
  activityFactor, ALLERGENS, blockedFoods, bmr, computeTargets, dayMacros, ensureVegFruit, FOOD_CATEGORIES, groceryList,
  mealSlots, roundGrams, scaleDay, scaleMeal, slotKcal, varietyIssues, vegFruitServings, withinTargets,
  type PlanDay,
} from '../src/engine/nutrition';

const N = COACH.nutrition;
const foods = new Map(FOODS.map((f) => [f.id, f]));
const persian = /[؀-ۿ]/;

describe('food seed', () => {
  it('has about 200 foods with unique ids and Persian names', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(195);
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      expect(f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f.nameFa, f.id).toMatch(persian);
      expect(FOOD_CATEGORIES).toContain(f.category);
      for (const a of f.allergens) expect(ALLERGENS).toContain(a);
      for (const v of [f.kcal, f.protein, f.carbs, f.fat, f.fiber]) expect(v, f.id).toBeGreaterThanOrEqual(0);
      expect(f.protein + f.carbs + f.fat, f.id).toBeLessThanOrEqual(101);
      if (f.whole) expect(f.unit, f.id).not.toBeNull();
    }
  });

  it('has energy consistent with its macros (Atwater 4/4/9, minus part of the fibre)', () => {
    // Cocoa: USDA uses cocoa-specific energy factors (much of its carbohydrate is not available).
    for (const f of FOODS.filter((x) => x.id !== 'cocoa-powder')) {
      const atwater = 4 * f.protein + 4 * (f.carbs - f.fiber * 0.5) + 9 * f.fat;
      // Branded/regional variation and fibre handling: within 15 % or 25 kcal.
      expect(Math.abs(atwater - f.kcal), `${f.id}: ${f.kcal} vs ${atwater.toFixed(0)}`).toBeLessThanOrEqual(Math.max(25, f.kcal * 0.15));
    }
  });

  it('covers the Persian staples and gain-friendly foods the spec lists', () => {
    for (const id of ['rice-white-cooked', 'bread-sangak', 'bread-barbari', 'bread-lavash', 'lentils-cooked', 'chickpeas-cooked', 'kidney-beans-cooked',
      'split-peas-cooked', 'chicken-breast-cooked', 'beef-stew-cooked', 'lamb-cooked', 'trout-cooked', 'egg', 'yogurt-whole', 'doogh', 'feta', 'milk-whole',
      'dates', 'raisins', 'walnuts', 'almonds', 'pistachios', 'tahini', 'olive-oil', 'potato-boiled', 'herbs-mixed', 'oats', 'peanut-butter', 'whey',
      'banana', 'granola']) expect(foods.has(id), id).toBe(true);
    const kinds = new Set(FOODS.map((f) => f.proteinKind).filter(Boolean));
    expect(kinds.size).toBeGreaterThanOrEqual(8);
  });
});

describe('targets', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    expect(bmr('male', 70, 178, 29)).toBeCloseTo(10 * 70 + 6.25 * 178 - 5 * 29 + 5, 6);
    expect(bmr('female', 60, 165, 30)).toBeCloseTo(600 + 1031.25 - 150 - 161, 6);
  });

  it('keeps the activity factor in 1.4–1.75', () => {
    expect(activityFactor('sedentary', 3)).toBeCloseTo(1.425, 6);
    expect(activityFactor('light', 4)).toBeCloseTo(1.55, 6);
    expect(activityFactor('sedentary', 0)).toBe(1.4);
    expect(activityFactor('active', 6)).toBe(1.75);
  });

  it('splits macros by the rules', () => {
    const t = computeTargets({ sex: 'male', weightKg: 70, heightCm: 178, age: 29, activity: 'light', trainingDays: 4 });
    expect(t.bmr).toBe(Math.round(bmr('male', 70, 178, 29)));
    expect(t.kcal).toBe(Math.round((t.bmr * 1.55 + 300) / 10) * 10);
    expect(t.protein).toBe(126);
    expect(t.fat).toBeGreaterThanOrEqual(Math.round((t.kcal * 0.2) / 9) - 1);
    expect(t.fat / 70).toBeGreaterThanOrEqual(0.8);
    expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal)).toBeLessThanOrEqual(6);
    expect(t.fiber).toBe(Math.round((14 * t.kcal) / 1000));
    expect(t.waterMl).toBe(2450);
    expect(t.proteinPerMeal).toBe(28);
  });

  it('raises fat above 1 g/kg only when 20 % of energy needs it', () => {
    const t = computeTargets({ sex: 'male', weightKg: 50, heightCm: 185, age: 20, activity: 'active', trainingDays: 6, surplusKcal: 500 });
    expect(t.fat).toBe(Math.round((t.kcal * 0.2) / 9));
    expect(t.fat).toBeGreaterThan(50);
  });
});

describe('meal slots', () => {
  it('adds the daily shake for low/normal appetite', () => {
    expect(mealSlots(3, 'low')).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(mealSlots(4, 'low')).toEqual(['breakfast', 'lunch', 'shake', 'dinner']);
    expect(mealSlots(4, 'high')).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(mealSlots(5, 'normal')).toEqual(['breakfast', 'snack', 'lunch', 'shake', 'dinner']);
    expect(mealSlots(6, 'low')).toEqual(['breakfast', 'snack', 'lunch', 'shake', 'dinner', 'snack']);
  });
  it('shares the day by slot', () => {
    const k = slotKcal(['breakfast', 'lunch', 'dinner'], 3000);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(3000, -1);
    expect(k[1]).toBeGreaterThan(k[0]!);
  });
});

// A plausible LLM day: a bit low in kcal and protein.
const day = (): PlanDay => [
  { slot: 'breakfast', nameFa: 'نان و پنیر و گردو', cookMinutes: 5, items: [{ food: 'bread-barbari', grams: 100 }, { food: 'feta', grams: 40 }, { food: 'walnuts', grams: 20 }, { food: 'cucumber', grams: 50 }, { food: 'egg', grams: 100 }] },
  { slot: 'lunch', nameFa: 'چلو جوجه', cookMinutes: 40, items: [{ food: 'rice-white-cooked', grams: 250 }, { food: 'chicken-breast-cooked', grams: 120 }, { food: 'tomato', grams: 120 }, { food: 'yogurt-whole', grams: 100 }] },
  { slot: 'shake', nameFa: 'شیک موز و جو', cookMinutes: 5, items: [{ food: 'milk-whole', grams: 300 }, { food: 'oats', grams: 40 }, { food: 'banana', grams: 120 }, { food: 'peanut-butter', grams: 20 }] },
  { slot: 'dinner', nameFa: 'عدسی با نان', cookMinutes: 30, items: [{ food: 'lentils-cooked', grams: 200 }, { food: 'bread-sangak', grams: 80 }, { food: 'onion', grams: 50 }, { food: 'olive-oil', grams: 10 }, { food: 'herbs-mixed', grams: 30 }] },
];

describe('portion scaler', () => {
  const t = computeTargets({ sex: 'male', weightKg: 70, heightCm: 178, age: 29, activity: 'light', trainingDays: 4 });

  it('lands each day within ±5 % kcal and ±10 % protein', () => {
    const before = dayMacros(day(), foods);
    expect(withinTargets(before, t)).toBe(false);
    const r = scaleDay(day(), foods, t);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.macros.kcal - t.kcal) / t.kcal).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r.macros.protein - t.protein) / t.protein).toBeLessThanOrEqual(0.1);
  });

  it('keeps portions measurable and within half to double', () => {
    const orig = day();
    const r = scaleDay(orig, foods, t);
    r.day.forEach((m, mi) => m.items.forEach((it, ii) => {
      const f = foods.get(it.food)!;
      const o = orig[mi]!.items[ii]!.grams;
      expect(it.grams).toBe(roundGrams(f, it.grams));
      if (f.whole) expect(it.grams % f.unit!.g).toBe(0);
      expect(it.grams).toBeGreaterThanOrEqual(Math.min(o, Math.floor(o * 0.5)) - 5);
      expect(it.grams).toBeLessThanOrEqual(o * 2 + 5);
    }));
  });

  it('works downward too, and is deterministic', () => {
    const small = computeTargets({ sex: 'female', weightKg: 55, heightCm: 160, age: 35, activity: 'sedentary', trainingDays: 3 });
    const a = scaleDay(day(), foods, small), b = scaleDay(day(), foods, small);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it('reports when a day cannot reach the target within the bounds', () => {
    const tiny: PlanDay = [{ slot: 'breakfast', nameFa: 'سیب', cookMinutes: 0, items: [{ food: 'apple', grams: 180 }] }];
    expect(scaleDay(tiny, foods, t).ok).toBe(false);
  });

  it('scales a swapped meal to the macros of the one it replaces', () => {
    const goal = { kcal: 800, protein: 45 };
    const m = scaleMeal(day()[1]!, foods, goal);
    const mm = dayMacros([m], foods);
    expect(withinTargets(mm, goal)).toBe(true);
  });
});

describe('variety and produce', () => {
  it('flags repeated meals, few protein/carb sources and low produce', () => {
    const week = Array.from({ length: 7 }, () => day());
    const issues = varietyIssues(week, foods).map((i) => i.rule);
    expect(issues).toContain('same_meal');
    expect(issues).not.toContain('protein_sources'); // egg, dairy, chicken, legume
  });

  it('tops a day up to five servings of fruit and vegetables', () => {
    const d = day();
    expect(vegFruitServings(d, foods)).toBeLessThan(N.plan.minVegFruitServingsPerDay);
    const fixed = ensureVegFruit(d, foods, { fruit: 'apple', salad: ['cucumber', 'tomato', 'lettuce'] });
    expect(vegFruitServings(fixed, foods)).toBeGreaterThanOrEqual(N.plan.minVegFruitServingsPerDay - 0.05);
  });

  it('matches dislikes and allergies against food names and allergen tags', () => {
    const b = blockedFoods(FOODS, 'بادمجان، لاکتوز');
    expect(b.has('eggplant')).toBe(true);
    expect(b.has('milk-whole')).toBe(true);
    expect(b.has('feta')).toBe(true);
    expect(b.has('rice-white-cooked')).toBe(false);
    expect(blockedFoods(FOODS, 'peanuts').has('peanut-butter')).toBe(true);
    expect(blockedFoods(FOODS, null).size).toBe(0);
  });

  it('builds a grocery list in raw amounts, grouped by category', () => {
    const g = groceryList([day(), day()], foods);
    const rice = g.find((l) => l.food === 'rice-white-cooked')!;
    expect(rice.grams).toBe(Math.ceil((500 * 0.36) / 10) * 10);
    expect(g.find((l) => l.food === 'egg')!.units).toBe(4);
    const cats = g.map((l) => FOOD_CATEGORIES.indexOf(l.category));
    expect(cats).toEqual([...cats].sort((a, b) => a - b));
  });
});
