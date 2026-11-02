import OpenAI from 'openai';
import { COACH } from './coach.config';
import { env } from './config';
import { maybeOne, query } from './db/pool';
import type { Exercise } from './engine/library';
import type { CallHooks } from './openai/structured';
import { SupabaseStorage, type Storage } from './storage';
import { dbCallHooks } from './usage';

// Exercise illustrations (spec §7): one image per exercise, generated once with OPENAI_IMAGE_MODEL,
// stored in the private `exercise-images` bucket and cached forever. The written cues stay primary;
// the owner can flag a wrong image (hidden) or regenerate it.

export const EXERCISE_IMAGE_BUCKET = 'exercise-images';
const I = COACH.exerciseImages;

export interface ImageResult { b64: string; usage: { inputTokens: number; outputTokens: number } }
export interface ImageTransport { generate(prompt: string): Promise<ImageResult> }

export class OpenAIImageTransport implements ImageTransport {
  private client: OpenAI;
  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.client = new OpenAI({ apiKey, maxRetries: Number(process.env.OPENAI_MAX_RETRIES ?? 3), timeout: 180_000 });
  }
  async generate(prompt: string): Promise<ImageResult> {
    const res = await this.client.images.generate({
      model: env().OPENAI_IMAGE_MODEL, prompt, n: 1, size: I.size, quality: I.quality, output_format: I.format, background: 'opaque',
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('image model returned no image');
    return { b64, usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 } };
  }
}

/** One consistent style for every exercise (spec §7): two panels, no text, muscles subtly highlighted. */
export function exerciseImagePrompt(e: Pick<Exercise, 'nameEn' | 'primary' | 'secondary' | 'equipment'>): string {
  const equipment = e.equipment[0]?.length ? e.equipment[0].join(' and ').replace(/_/g, ' ') : 'no equipment';
  return [
    `Clean anatomical fitness illustration of the exercise "${e.nameEn}" (${equipment}).`,
    'Two panels side by side on one image: left panel the start position, right panel the end position, the same person in both.',
    'Side or three-quarter view so the joint angles and the back position are clearly visible; correct, safe technique.',
    `Working muscles subtly highlighted in a warm saffron tone: ${e.primary.join(', ').replace(/_/g, ' ')}${e.secondary.length ? ` (lighter: ${e.secondary.join(', ').replace(/_/g, ' ')})` : ''}.`,
    'Neutral athletic clothing, plain light grey background, soft even lighting, flat modern medical-illustration style.',
    'Absolutely no text, letters, numbers, labels, arrows with words, logos, brands or watermarks anywhere in the image.',
  ].join(' ');
}

/** Exercise images generated this month (successful calls), for the count cap. */
export async function imagesThisMonth(userId: string): Promise<number> {
  const r = await maybeOne<{ n: string }>(
    `select count(*) as n from public.ai_usage
     where user_id = $1 and feature = 'exercise_image' and ok and created_at >= date_trunc('month', now())`, [userId]);
  return Number(r?.n ?? 0);
}

export class ImageLimitError extends Error {
  constructor() { super('Monthly exercise image limit reached'); this.name = 'ImageLimitError'; }
}

/**
 * Generate (or regenerate) the illustration for one exercise and store it. Non-essential: blocked by
 * the monthly money budget and by the monthly image count. Returns the storage path.
 */
export async function generateExerciseImage(
  userId: string,
  e: Pick<Exercise, 'slug' | 'nameEn' | 'primary' | 'secondary' | 'equipment'>,
  deps: { transport?: ImageTransport; storage?: Storage; hooks?: CallHooks } = {},
): Promise<string> {
  const hooks = deps.hooks ?? dbCallHooks;
  await hooks.checkBudget({ userId, feature: 'exercise_image' });
  if ((await imagesThisMonth(userId)) >= I.maxPerMonth) throw new ImageLimitError();
  const model = env().OPENAI_IMAGE_MODEL;
  let ok = false;
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const img = await (deps.transport ?? new OpenAIImageTransport()).generate(exerciseImagePrompt(e));
    usage = img.usage;
    const path = `${e.slug}-v${I.promptVersion}-${Date.now().toString(36)}.${I.format}`;
    await (deps.storage ?? new SupabaseStorage()).upload(EXERCISE_IMAGE_BUCKET, path, Buffer.from(img.b64, 'base64'), `image/${I.format}`);
    await query(`update public.exercises set image_url = $2, image_status = 'ok' where slug = $1`, [e.slug, path]);
    ok = true;
    return path;
  } finally {
    // Image prices are unverified (docs/openai-api-notes.md): tokens are logged, cost stays 0, the count cap applies.
    await hooks.logUsage({
      userId, feature: 'exercise_image', model, inputTokens: usage.inputTokens, cachedTokens: 0, cacheWriteTokens: 0,
      outputTokens: usage.outputTokens, reasoningTokens: 0, costUsd: 0, ok, requestId: null,
    });
  }
}

