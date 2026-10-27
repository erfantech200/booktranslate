import type { z } from 'zod';
import { PermanentError, type JobContext } from './context';
import { MealPlanPayload, runMealPlan } from './mealPlan';

export * from './context';

export interface JobHandler<P> {
  payload: z.ZodType<P>;
  run(ctx: JobContext, payload: P): Promise<unknown>;
}

// Background job types and their handlers. Features add theirs here (exercise image batches,
// weekly meal plans, the weekly check-in). Unknown types fail permanently.
const handlers: Record<string, JobHandler<any>> = {
  meal_plan: { payload: MealPlanPayload, run: runMealPlan },
};

export const jobTypes = () => Object.keys(handlers);

export async function runJob(ctx: JobContext): Promise<unknown> {
  const h = handlers[ctx.job.type];
  if (!h) throw new PermanentError(`job type ${ctx.job.type} is not implemented`);
  const parsed = h.payload.safeParse(ctx.job.payload);
  if (!parsed.success) throw new PermanentError(`invalid payload: ${parsed.error.message}`);
  return h.run(ctx, parsed.data);
}
