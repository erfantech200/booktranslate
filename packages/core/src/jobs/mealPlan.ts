import { z } from 'zod';
import { finishWeek, proposeWeek, type PlanPrefs } from '../coachText/mealPlan';
import { query, maybeOne, tx } from '../db/pool';
import { FOODS } from '../data/foods';
import { blockedFoods, itemsMacros, mealSlots, slotKcal, type Food } from '../engine/nutrition';
import { foodFromRow } from '../foodSeed';
import { BudgetExceededError, InvalidModelOutputError } from '../openai/structured';
import { checkpoint, JobYield, PermanentError, type JobContext } from './context';

// Background job: build the weekly meal plan for meal_plans.id = planId (spec §9). One model call
// proposes the week; the engine scales and stores it. Runs with the service role (worker).

export const MealPlanPayload = z.object({ planId: z.string().uuid() });

/** Foods the owner may eat: the seed plus their own, minus dislikes and allergies. */
export async function allowedFoods(userId: string, prefs: Pick<PlanPrefs, 'dislikes' | 'allergies'>): Promise<Food[]> {
  const rows = await query(`select * from public.foods where user_id is null or user_id = $1`, [userId]);
  const all = rows.length ? rows.map(foodFromRow) : [...FOODS];
  const blocked = blockedFoods(all, [prefs.dislikes, prefs.allergies].filter(Boolean).join('، '));
  // Supplements other than whey never enter a plan (spec §9); hand-entered extras stay out too.
  return all.filter((f) => !blocked.has(f.id) && !f.id.startsWith('ai-') && f.id !== 'soft-drink' && f.id !== 'potato-chips');
}

export async function runMealPlan(ctx: JobContext, { planId }: z.infer<typeof MealPlanPayload>) {
  const plan = await maybeOne(`select * from public.meal_plans where id = $1`, [planId]);
  if (!plan) throw new PermanentError('meal plan not found');
  if (plan.status === 'ready') return { skipped: 'already ready' };
  const userId: string = plan.user_id;
  const profile = await maybeOne(`select * from public.profile where user_id = $1`, [userId]);
  const target = await maybeOne(`select * from public.nutrition_targets where id = $1`, [plan.target_id]);
  if (!profile || !target) throw new PermanentError('profile or targets missing');

  const prefs: PlanPrefs = {
    cuisines: profile.cuisines ?? ['persian'],
    dislikes: profile.disliked_foods, allergies: profile.allergies, rules: profile.dietary_rules,
    cookingMinutes: profile.cooking_minutes ?? 45, budget: profile.budget ?? 'medium', appetite: profile.appetite ?? 'normal',
  };
  const foods = await allowedFoods(userId, prefs);
  const slots = mealSlots(profile.meals_per_day ?? 4, prefs.appetite);
  const targets = { kcal: target.kcal, protein: target.protein_g, proteinPerMeal: Math.round(0.4 * Number(target.weight_kg)) };
  const recent = (await query<{ name_fa: string }>(
    `select distinct m.name_fa from public.meals m join public.meal_plans p on p.id = m.plan_id
     where p.user_id = $1 and p.id <> $2 and p.week_start >= $3::date - 14`, [userId, planId, plan.week_start])).map((r) => r.name_fa);

  try {
    // One model call can take a couple of minutes: start it only with enough time left in this run.
    checkpoint(ctx, 200_000);
    ctx.log('meal plan: proposing week', { foods: foods.length, slots });
    const proposed = await proposeWeek(userId, { prefs, targets, slots, slotKcal: slotKcal(slots, targets.kcal), foods, recent }, ctx.deps);
    await ctx.heartbeat();
    const week = finishWeek(proposed, { foods, targets });
    const byId = new Map(foods.map((f) => [f.id, f]));
    await tx(async (c) => {
      await query(`delete from public.meals where plan_id = $1`, [planId], c);
      for (const [d, day] of week.days.entries()) {
        for (const [i, meal] of day.entries()) {
          const m = itemsMacros(meal.items, byId);
          const row = await maybeOne<{ id: string }>(
            `insert into public.meals (user_id, plan_id, day_idx, idx, slot, name_fa, cook_minutes, kcal, protein_g, carbs_g, fat_g)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
            [userId, planId, d, i, meal.slot, meal.nameFa, meal.cookMinutes, m.kcal.toFixed(1), m.protein.toFixed(1), m.carbs.toFixed(1), m.fat.toFixed(1)], c);
          for (const [k, it] of meal.items.entries()) {
            await query(`insert into public.meal_items (user_id, meal_id, idx, food_id, grams) values ($1,$2,$3,$4,$5)`, [userId, row!.id, k, it.food, it.grams], c);
          }
        }
      }
      await query(`update public.meal_plans set status = 'ready', error = null, warnings = $2 where id = $1`, [planId, JSON.stringify(week.warnings)], c);
    });
    return { days: week.days.length, warnings: week.warnings };
  } catch (err) {
    if (err instanceof JobYield) throw err;
    const final = err instanceof InvalidModelOutputError || err instanceof BudgetExceededError || ctx.job.attempts >= ctx.job.max_attempts;
    if (final) {
      const code = err instanceof BudgetExceededError ? 'budget' : err instanceof InvalidModelOutputError ? 'invalid' : 'error';
      await query(`update public.meal_plans set status = 'failed', error = $2 where id = $1`, [planId, code]);
    }
    if (err instanceof InvalidModelOutputError) throw new PermanentError(err.message);
    throw err;
  }
}
