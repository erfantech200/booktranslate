import { z } from 'zod';
import { EXERCISES } from '../data/exercises';
import { query } from '../db/pool';
import { generateExerciseImage, ImageLimitError, OpenAIImageTransport, type ImageTransport } from '../images';
import { BudgetExceededError } from '../openai/structured';
import { checkpoint, type JobContext } from './context';

// Batch: illustrate every exercise that has no image yet (spec §7, "via a batch admin action").
// One image at a time; yields before running out of time and continues in the next run. Stops
// quietly at the monthly image cap or the money budget (what is done stays done).

export const ExerciseImagesPayload = z.object({ only: z.array(z.string().max(80)).max(200).optional() });

export async function runExerciseImages(ctx: JobContext, payload: z.infer<typeof ExerciseImagesPayload>, transport?: ImageTransport) {
  const userId = ctx.job.user_id;
  const rows = await query<{ slug: string }>(
    `select slug from public.exercises where image_url is null and image_status = 'pending' order by slug`);
  const todo = rows.map((r) => r.slug).filter((s) => !payload.only || payload.only.includes(s));
  const bySlug = new Map(EXERCISES.map((e) => [e.slug, e]));
  const images = transport ?? new OpenAIImageTransport();
  let done = 0;
  for (const slug of todo) {
    const e = bySlug.get(slug);
    if (!e) continue;
    checkpoint(ctx, 120_000); // one image takes up to ~1–2 minutes
    try {
      await generateExerciseImage(userId, e, { transport: images, storage: ctx.deps.storage, hooks: ctx.deps.hooks });
      done++;
    } catch (err) {
      if (err instanceof ImageLimitError || err instanceof BudgetExceededError) {
        ctx.log('exercise images stopped', { reason: err.name, done });
        return { done, stopped: err.name };
      }
      ctx.log('exercise image failed', { slug, err: err instanceof Error ? err.message : String(err) });
    }
    await ctx.heartbeat();
  }
  return { done };
}
