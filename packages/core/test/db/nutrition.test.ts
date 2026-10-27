import { describe, expect, it } from 'vitest';
import { one, query } from '../../src/db/pool';
import { FOODS } from '../../src/data/foods';
import { foodSeedStatus, syncFoods } from '../../src/foodSeed';
import { enqueue } from '../../src/queue';
import { runAvailable } from '../../src/runner';
import { LocalStorage } from '../../src/storage';
import type { ModelTransport, TransportResponse } from '../../src/openai/structured';
import { asUser, createUser, RUN } from './helpers';

describe.skipIf(!RUN)('food database', () => {
  it('is synced from the seed', async () => {
    expect(await foodSeedStatus()).toEqual({ total: FOODS.length, missing: [], changed: [] });
    expect((await syncFoods()).written).toEqual([]);
  });

  it('lets the owner add estimated foods but never change the seed', async () => {
    const a = await createUser('food-a@example.com');
    const b = await createUser('food-b@example.com');
    await asUser(a, 'food-a@example.com', async (q) => {
      await q(`insert into public.foods (id, user_id, name_fa, category, kcal, protein_g, carbs_g, fat_g, estimated, source)
               values ('ai-cake-1', $1, 'کیک خانگی', 'pantry', 380, 6, 55, 15, true, 'ai')`, [a]);
      await expect(q(`update public.foods set kcal = 1 where id = 'egg'`)).resolves.toEqual([]);
      expect((await q(`select kcal from public.foods where id = 'egg'`))[0].kcal).toBe('143.0');
      await expect(q(`insert into public.foods (id, user_id, name_fa, category, kcal, protein_g, carbs_g, fat_g, source)
               values ('fake-seed', $1, 'x', 'pantry', 1, 0, 0, 0, 'seed')`, [a])).rejects.toThrow();
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b, role: 'authenticated' })]);
      expect(await q(`select id from public.foods where id = 'ai-cake-1'`)).toEqual([]);
      expect((await q(`select count(*)::int as n from public.foods`))[0].n).toBe(FOODS.length);
    });
  });
});

describe.skipIf(!RUN)('meal plan job', () => {
  it('builds and stores a week through the queue, with targets met', async () => {
    const u = await createUser('plan@example.com');
    await query(`insert into public.profile (user_id, onboarded_at, sex, birth_year, height_cm, experience, days_per_week, session_minutes,
      daily_activity, cuisines, cooking_minutes, budget, meals_per_day, appetite, start_date, start_weight_kg)
      values ($1, now(), 'male', 1997, 178, 'none', 4, 60, 'light', '{persian}', 45, 'medium', 3, 'high', '2026-10-24', 70)`, [u]);
    const target = await one(`insert into public.nutrition_targets (user_id, effective_from, kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, bmr, tdee, factor, surplus, weight_kg, reason)
      values ($1, '2026-10-24', 2900, 126, 400, 63, 41, 2450, 1700, 2600, 1.55, 300, 70, 'initial') returning id`, [u]);
    const plan = await one(`insert into public.meal_plans (user_id, week_start, target_id) values ($1, '2026-10-24', $2) returning id`, [u, target.id]);
    const mk = (slot: string, name: string, items: [string, number][]) => ({ slot, name_fa: name, cook_minutes: 20, items: items.map(([food, grams]) => ({ food, grams })) });
    const B = [mk('breakfast', 'نان و پنیر', [['bread-barbari', 120], ['feta', 50], ['walnuts', 20], ['egg', 100]]), mk('breakfast', 'املت', [['egg', 150], ['tomato', 150], ['bread-sangak', 120], ['olive-oil', 10]]),
      mk('breakfast', 'حلیم جو', [['oats', 90], ['milk-whole', 300], ['greek-yogurt', 150]]), mk('breakfast', 'نان و تخم‌مرغ', [['bread-lavash', 90], ['egg', 150], ['cucumber', 120]])];
    const L = [mk('lunch', 'چلو جوجه', [['rice-white-cooked', 300], ['chicken-breast-cooked', 160]]), mk('lunch', 'قورمه', [['rice-white-cooked', 280], ['beef-stew-cooked', 130], ['kidney-beans-cooked', 60], ['herbs-ghormeh', 80], ['vegetable-oil', 15]]),
      mk('lunch', 'ماهی', [['trout-cooked', 180], ['potato-baked', 300], ['olive-oil', 10]]), mk('lunch', 'کوبیده', [['rice-white-cooked', 300], ['ground-lamb-cooked', 130], ['tomato', 120]])];
    const D = [mk('dinner', 'عدسی', [['lentils-cooked', 300], ['bread-sangak', 100], ['olive-oil', 10]]), mk('dinner', 'ماکارونی', [['pasta-cooked', 300], ['ground-beef-lean-cooked', 130]]),
      mk('dinner', 'مرغ و بلغور', [['chicken-thigh-cooked', 160], ['bulgur-cooked', 250], ['olive-oil', 10]]), mk('dinner', 'عدس‌پلو', [['rice-white-cooked', 250], ['lentils-cooked', 120], ['yogurt-whole', 150]])];
    const week = { days: Array.from({ length: 7 }, (_, i) => ({ meals: [B[i % 4], L[i % 4], D[i % 4]] })) };
    const transport: ModelTransport = { async create() { return { json: week, refusal: null, incomplete: null, requestId: 'r', usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0 } } as TransportResponse; } };
    const job = await enqueue({ userId: u, type: 'meal_plan', payload: { planId: plan.id }, dedupeKey: `meal_plan:${plan.id}` });
    const usage: string[] = [];
    await runAvailable({ storage: new LocalStorage(), transport, hooks: { checkBudget: async () => {}, logUsage: async (r) => { usage.push(r.feature); } } }, 5, { workerId: 'test', log: () => {} });
    expect((await one(`select status, last_error from public.jobs where id = $1`, [job])).status).toBe('done');
    const p = await one(`select status, warnings from public.meal_plans where id = $1`, [plan.id]);
    expect(p).toEqual({ status: 'ready', warnings: [] });
    const days = await query(`select day_idx, sum(kcal)::float as kcal, sum(protein_g)::float as p, count(*)::int as n from public.meals where plan_id = $1 group by day_idx order by day_idx`, [plan.id]);
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.n).toBe(3);
      expect(Math.abs(d.kcal - 2900) / 2900).toBeLessThanOrEqual(0.05);
      expect(Math.abs(d.p - 126) / 126).toBeLessThanOrEqual(0.1);
    }
    expect(usage).toEqual(['meal_plan']);
    // The owner reads their plan through RLS.
    await asUser(u, 'plan@example.com', async (q) => {
      expect((await q(`select count(*)::int as n from public.meal_items`))[0].n).toBeGreaterThan(20);
    });
  });
});
