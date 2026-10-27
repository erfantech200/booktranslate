import { describe, expect, it } from 'vitest';
import { finishWeek, proposeSwap, proposeWeek, swapFromPlan, type PlanRequest } from '../src/coachText/mealPlan';
import { parseFoods, saneNewFood } from '../src/coachText/foodParse';
import { FOODS } from '../src/data/foods';
import { computeTargets, dayMacros, mealSlots, slotKcal, varietyIssues, vegFruitServings, withinTargets } from '../src/engine/nutrition';
import type { ModelTransport, TransportResponse, UsageRecord } from '../src/openai/structured';

const u = { inputTokens: 1000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 500, reasoningTokens: 0 };
function scripted(responses: unknown[]): ModelTransport & { reqs: any[] } {
  const reqs: any[] = [];
  return { reqs, async create(req) { reqs.push(req); return { json: responses.shift(), refusal: null, incomplete: null, requestId: 'r', usage: u } as TransportResponse; } };
}
const hooks = () => { const logged: UsageRecord[] = []; return { logged, hooks: { checkBudget: async () => {}, logUsage: async (r: UsageRecord) => { logged.push(r); } } }; };

const foods = [...FOODS];
const byId = new Map(foods.map((f) => [f.id, f]));
const t = computeTargets({ sex: 'male', weightKg: 70, heightCm: 178, age: 29, activity: 'light', trainingDays: 4 });
const slots = mealSlots(4, 'low');
const req: PlanRequest = {
  prefs: { cuisines: ['persian'], dislikes: null, allergies: null, rules: null, cookingMinutes: 45, budget: 'medium', appetite: 'low' },
  targets: { kcal: t.kcal, protein: t.protein, proteinPerMeal: t.proteinPerMeal }, slots, slotKcal: slotKcal(slots, t.kcal), foods,
};

const B = [
  { slot: 'breakfast', name_fa: 'نان و پنیر و گردو', cook_minutes: 5, items: [{ food: 'bread-barbari', grams: 100 }, { food: 'feta', grams: 40 }, { food: 'walnuts', grams: 20 }, { food: 'egg', grams: 100 }] },
  { slot: 'breakfast', name_fa: 'املت گوجه', cook_minutes: 15, items: [{ food: 'egg', grams: 150 }, { food: 'tomato', grams: 150 }, { food: 'bread-sangak', grams: 100 }, { food: 'olive-oil', grams: 10 }] },
  { slot: 'breakfast', name_fa: 'حلیم جو', cook_minutes: 10, items: [{ food: 'oats', grams: 80 }, { food: 'milk-whole', grams: 300 }, { food: 'dates', grams: 30 }, { food: 'greek-yogurt', grams: 150 }] },
  { slot: 'breakfast', name_fa: 'نان و تخم‌مرغ آب‌پز', cook_minutes: 10, items: [{ food: 'bread-lavash', grams: 90 }, { food: 'egg', grams: 150 }, { food: 'cucumber', grams: 120 }, { food: 'butter', grams: 10 }] },
];
const L = [
  { slot: 'lunch', name_fa: 'چلو جوجه', cook_minutes: 40, items: [{ food: 'rice-white-cooked', grams: 250 }, { food: 'chicken-breast-cooked', grams: 150 }, { food: 'yogurt-whole', grams: 100 }] },
  { slot: 'lunch', name_fa: 'قورمه سبزی', cook_minutes: 30, items: [{ food: 'rice-white-cooked', grams: 220 }, { food: 'beef-stew-cooked', grams: 120 }, { food: 'kidney-beans-cooked', grams: 60 }, { food: 'herbs-ghormeh', grams: 80 }, { food: 'vegetable-oil', grams: 15 }] },
  { slot: 'lunch', name_fa: 'ماهی و سیب‌زمینی', cook_minutes: 30, items: [{ food: 'trout-cooked', grams: 160 }, { food: 'potato-baked', grams: 250 }, { food: 'olive-oil', grams: 10 }, { food: 'lettuce', grams: 80 }] },
  { slot: 'lunch', name_fa: 'چلو کباب کوبیده', cook_minutes: 40, items: [{ food: 'rice-white-cooked', grams: 250 }, { food: 'ground-lamb-cooked', grams: 120 }, { food: 'tomato', grams: 120 }, { food: 'onion', grams: 40 }] },
];
const S = { slot: 'shake', name_fa: 'شیک موز', cook_minutes: 5, items: [{ food: 'milk-whole', grams: 300 }, { food: 'oats', grams: 40 }, { food: 'banana', grams: 120 }, { food: 'peanut-butter', grams: 20 }] };
const D = [
  { slot: 'dinner', name_fa: 'عدسی', cook_minutes: 30, items: [{ food: 'lentils-cooked', grams: 250 }, { food: 'bread-sangak', grams: 80 }, { food: 'onion', grams: 50 }, { food: 'olive-oil', grams: 10 }] },
  { slot: 'dinner', name_fa: 'ماکارونی', cook_minutes: 35, items: [{ food: 'pasta-cooked', grams: 250 }, { food: 'ground-beef-lean-cooked', grams: 120 }, { food: 'tomato-paste', grams: 20 }, { food: 'vegetable-oil', grams: 10 }] },
  { slot: 'dinner', name_fa: 'خوراک مرغ و سبزیجات', cook_minutes: 30, items: [{ food: 'chicken-thigh-cooked', grams: 150 }, { food: 'bulgur-cooked', grams: 200 }, { food: 'zucchini', grams: 150 }, { food: 'olive-oil', grams: 10 }] },
  { slot: 'dinner', name_fa: 'عدس‌پلو با ماست', cook_minutes: 40, items: [{ food: 'rice-white-cooked', grams: 200 }, { food: 'lentils-cooked', grams: 120 }, { food: 'raisins', grams: 20 }, { food: 'yogurt-whole', grams: 150 }, { food: 'vegetable-oil', grams: 10 }] },
];
const goodWeek = { days: Array.from({ length: 7 }, (_, i) => ({ meals: [B[i % 4], L[i % 4], S, D[i % 4]] })) };

describe('weekly plan', () => {
  it('asks again when the slots are wrong, then finishes the week inside targets', async () => {
    const bad = { days: goodWeek.days.map((d) => ({ meals: d.meals.slice(0, 3) })) };
    const tr = scripted([bad, goodWeek]);
    const h = hooks();
    const week = await proposeWeek('u', req, { transport: tr, hooks: h.hooks });
    expect(tr.reqs).toHaveLength(2);
    expect(JSON.stringify(tr.reqs[1].input)).toContain('it must have exactly');
    expect(h.logged.every((l) => l.feature === 'meal_plan')).toBe(true);
    // Catalogue ids constrain the output schema (no invented foods).
    expect(JSON.stringify(tr.reqs[0].input)).toContain('rice-white-cooked | برنج سفید پخته');
    const done = finishWeek(week, req);
    expect(done.warnings).toEqual([]);
    for (const d of done.days) {
      expect(withinTargets(dayMacros(d, byId), t)).toBe(true);
      expect(vegFruitServings(d, byId)).toBeGreaterThanOrEqual(4.95);
    }
    expect(varietyIssues(done.days, byId)).toEqual([]);
  });

  it('rejects a week that repeats one meal too often', async () => {
    const mono = { days: Array.from({ length: 7 }, () => ({ meals: [B[0], L[0], S, D[0]] })) };
    const tr = scripted([mono, mono]);
    await expect(proposeWeek('u', req, { transport: tr, hooks: hooks().hooks })).rejects.toThrow(/Invalid meal_plan/);
    expect(JSON.stringify(tr.reqs[1].input)).toContain('same_meal');
  });

  it('swaps a meal for one with similar macros', async () => {
    const meal = { slot: 'lunch' as const, nameFa: 'چلو جوجه', cookMinutes: 40, items: L[0]!.items };
    const tr = scripted([{ meal: L[1] }]);
    const out = await proposeSwap('u', { meal, foods, prefs: req.prefs, avoid: [], proteinPerMeal: t.proteinPerMeal }, { transport: tr, hooks: hooks().hooks });
    expect(out.nameFa).toBe('قورمه سبزی');
    expect(withinTargets(dayMacros([out], byId), dayMacros([meal], byId))).toBe(true);
    const offline = swapFromPlan(meal, [[{ ...meal }, { slot: 'lunch', nameFa: 'ماهی', cookMinutes: 30, items: L[2]!.items }]], byId);
    expect(offline?.nameFa).toBe('ماهی');
  });
});

describe('food parsing', () => {
  it('maps text to catalogue foods and computes macros in code', async () => {
    const tr = scripted([{ items: [
      { food: 'egg', label_fa: 'دو تا تخم‌مرغ', grams: 100, new_food: null },
      { food: 'bread-sangak', label_fa: 'یه نون سنگک', grams: 300, new_food: null },
      { food: 'other', label_fa: 'کیک خانگی', grams: 80, new_food: { name_fa: 'کیک خانگی', name_en: 'Homemade cake', category: 'pantry', kcal: 900, protein: 6, carbs: 55, fat: 18, fiber: 1 } },
    ], note_fa: '' }]);
    const h = hooks();
    const r = await parseFoods('u', { text: 'دو تا تخم‌مرغ و یه نون سنگک و یه تیکه کیک' }, foods, { transport: tr, hooks: h.hooks });
    expect(r.items[0]).toMatchObject({ foodId: 'egg', grams: 100, estimated: false });
    expect(r.items[0]!.macros.protein).toBeCloseTo(12.6, 5);
    expect(r.items[1]!.estimated).toBe(true); // sangak macros are themselves estimates
    // The implausible 900 kcal/100 g cake is recomputed from its macros.
    expect(r.items[2]!.newFood!.kcal).toBe(Math.round(4 * 6 + 4 * (55 - 0.5) + 9 * 18));
    expect(r.items[2]!.estimated).toBe(true);
    expect(h.logged[0]).toMatchObject({ feature: 'food_text', essential: true });
  });

  it('marks photo estimates and sends the image', async () => {
    const tr = scripted([{ items: [{ food: 'rice-white-cooked', label_fa: 'برنج', grams: 200, new_food: null }], note_fa: 'مقدارها از روی عکس تخمین زده شده‌اند.' }]);
    const r = await parseFoods('u', { imageDataUrl: 'data:image/jpeg;base64,AAAA' }, foods, { transport: tr, hooks: hooks().hooks });
    expect(r.items[0]!.estimated).toBe(true);
    expect(r.note).toContain('عکس');
    expect(JSON.stringify(tr.reqs[0].input)).toContain('input_image');
  });

  it('keeps estimated foods physically possible', () => {
    const n = saneNewFood({ name_fa: 'x', name_en: 'x', category: 'pantry', kcal: 100, protein: 60, carbs: 60, fat: 20, fiber: 0 });
    expect(n.protein + n.carbs + n.fat).toBeLessThanOrEqual(100.2);
  });
});
