import { z } from 'zod';
import { textModel, visionModel } from '../config';
import { FOOD_CATEGORIES, macrosOf, type Food, type Macros } from '../engine/nutrition';
import { structuredCall, type InputContent } from '../openai/structured';
import { catalogue, type Deps } from './mealPlan';

// Free-text and photo food logging (spec §9). The model maps what was eaten to catalogue foods
// and gram amounts; the code computes the macros and the owner confirms before anything is saved.
// For a food missing from the catalogue the model estimates macros per 100 g, which the code
// sanity-checks; such foods are marked as estimates.

const NewFood = z.object({
  name_fa: z.string().min(2).max(60),
  name_en: z.string().max(60),
  category: z.enum(FOOD_CATEGORIES),
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
  fiber: z.number().min(0).max(60),
});
export type NewFood = z.infer<typeof NewFood>;

const parseSchema = (ids: [string, ...string[]]) => z.object({
  items: z.array(z.object({
    food: z.enum([...ids, 'other'] as [string, ...string[]]),
    label_fa: z.string().min(1).max(80),
    grams: z.number().min(1).max(2000),
    new_food: NewFood.nullable(),
  })).max(20),
  note_fa: z.string().max(200),
});

export const FOOD_PARSE_INSTRUCTIONS = `You turn a description of what someone ate into catalogue foods and grams, for a Persian food log.
- Map each food to the closest catalogue id. Amounts in grams as eaten (cooked weight for rice, meat, legumes).
- Convert household amounts with the catalogue's units and common Persian portions: یک کفگیر برنج ≈ 90 g, یک ربع نان سنگک ≈ 75 g,
  یک لیوان ≈ 245 g, یک قاشق غذاخوری روغن ≈ 13 g, یک سیخ کوبیده ≈ 90 g cooked ground meat, یک سیخ جوجه ≈ 120 g cooked chicken breast.
- Split mixed dishes into ingredients, including likely cooking oil.
- Only if nothing in the catalogue fits, use "other" with new_food: typical macros per 100 g from standard food tables; otherwise new_food is null.
- label_fa: the food as the person would call it ("دو تا تخم‌مرغ آب‌پز").
- note_fa: one short Persian sentence only if something was ambiguous; otherwise empty.
- Never invent foods that were not mentioned or visible. Return an empty list if the input is not about food.`;

const PHOTO_EXTRA = `This is a photo of a meal. Estimate each visible food and its weight from the plate, utensils and typical portion sizes.
Mention in note_fa that the amounts are estimated from the photo.`;

export interface ParsedItem {
  /** Catalogue id, or null for a new (estimated) food. */
  foodId: string | null;
  label: string;
  grams: number;
  newFood: NewFood | null;
  /** Computed from the catalogue (or the checked estimate). */
  macros: Macros;
  estimated: boolean;
}

/** Keep an estimated food physically possible: kcal close to its macros (Atwater), else recompute. */
export function saneNewFood(n: NewFood): NewFood {
  const sum = n.protein + n.carbs + n.fat;
  const scale = sum > 100 ? 100 / sum : 1;
  const p = n.protein * scale, c = n.carbs * scale, f = n.fat * scale;
  const atwater = 4 * p + 4 * Math.max(0, c - n.fiber / 2) + 9 * f;
  const kcal = Math.abs(atwater - n.kcal) > Math.max(30, n.kcal * 0.25) ? Math.round(atwater) : n.kcal;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { ...n, kcal, protein: r1(p), carbs: r1(c), fat: r1(f), fiber: r1(Math.min(n.fiber, c)) };
}

export async function parseFoods(userId: string, input: { text?: string; imageDataUrl?: string }, foods: Food[], deps: Deps): Promise<{ items: ParsedItem[]; note: string }> {
  const ids = foods.map((f) => f.id) as [string, ...string[]];
  const byId = new Map(foods.map((f) => [f.id, f]));
  const photo = !!input.imageDataUrl;
  const { model, effort } = photo ? visionModel() : textModel();
  const content: InputContent[] = [];
  if (input.text) content.push({ type: 'input_text', text: `What was eaten: ${input.text}` });
  if (input.imageDataUrl) content.push({ type: 'input_image', image_url: input.imageDataUrl, detail: 'auto' });
  content.push({ type: 'input_text', text: `Food catalogue (id | Persian name | per 100 g):\n${catalogue(foods)}` });
  const { value } = await structuredCall({
    transport: deps.transport,
    hooks: deps.hooks,
    // Logging what was eaten is essential: it keeps working when the monthly AI budget is used up.
    ctx: { userId, feature: photo ? 'food_photo' : 'food_text', essential: true },
    model,
    effort,
    schema: parseSchema(ids),
    schemaName: 'food_parse',
    instructions: photo ? `${FOOD_PARSE_INSTRUCTIONS}\n${PHOTO_EXTRA}` : FOOD_PARSE_INSTRUCTIONS,
    input: [{ role: 'user', content }],
    maxOutputTokens: 4000,
    cacheKey: 'food_parse_v1',
    check: (v) => (v.items.some((i) => i.food === 'other' && !i.new_food) ? 'items with food "other" need new_food' : null),
  });
  const items = value.items.map((i): ParsedItem => {
    if (i.food !== 'other') {
      const f = byId.get(i.food)!;
      return { foodId: f.id, label: i.label_fa, grams: Math.round(i.grams), newFood: null, macros: macrosOf(f, i.grams), estimated: photo || f.estimated };
    }
    const n = saneNewFood(i.new_food!);
    return { foodId: null, label: i.label_fa, grams: Math.round(i.grams), newFood: n, macros: macrosOf(n, i.grams), estimated: true };
  });
  return { items, note: value.note_fa.trim() };
}
