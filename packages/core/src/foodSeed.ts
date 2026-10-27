import { FOODS } from './data/foods';
import type { Food } from './engine/nutrition';
import { hashOf } from './hash';
import { query, type Queryable, getPool } from './db/pool';

// Syncs the reviewed food seed (src/data/foods.ts) into the `foods` table, like the exercise seed:
// only changed rows are written, and the owner's own (AI-estimated) foods are never touched.

export function foodRow(f: Food) {
  return {
    id: f.id, name_fa: f.nameFa, name_en: f.nameEn, category: f.category,
    kcal: f.kcal, protein_g: f.protein, carbs_g: f.carbs, fat_g: f.fat, fiber_g: f.fiber,
    unit_fa: f.unit?.fa ?? null, unit_g: f.unit?.g ?? null, whole: f.whole, veg_fruit: f.vegFruit,
    protein_kind: f.proteinKind, carb_kind: f.carbKind, allergens: f.allergens, raw_per_cooked: f.rawPerCooked,
    estimated: f.estimated, source: 'seed', content_hash: hashOf(f),
  };
}

/** A `foods` row (from the database) as an engine Food. */
export function foodFromRow(r: Record<string, any>): Food {
  return {
    id: r.id, nameFa: r.name_fa, nameEn: r.name_en ?? '', category: r.category,
    kcal: Number(r.kcal), protein: Number(r.protein_g), carbs: Number(r.carbs_g), fat: Number(r.fat_g), fiber: Number(r.fiber_g ?? 0),
    unit: r.unit_fa && r.unit_g ? { fa: r.unit_fa, g: Number(r.unit_g) } : null,
    whole: !!r.whole, vegFruit: !!r.veg_fruit, proteinKind: r.protein_kind ?? null, carbKind: r.carb_kind ?? null,
    allergens: r.allergens ?? [], rawPerCooked: r.raw_per_cooked == null ? null : Number(r.raw_per_cooked), estimated: !!r.estimated,
  };
}

export async function foodSeedStatus(db: Queryable = getPool()) {
  const rows = await query<{ id: string; content_hash: string }>(`select id, content_hash from public.foods where source = 'seed'`, [], db);
  const have = new Map(rows.map((r) => [r.id, r.content_hash]));
  return {
    total: FOODS.length,
    missing: FOODS.filter((f) => !have.has(f.id)).map((f) => f.id),
    changed: FOODS.filter((f) => have.has(f.id) && have.get(f.id) !== hashOf(f)).map((f) => f.id),
  };
}

export async function syncFoods(db: Queryable = getPool()): Promise<{ written: string[] }> {
  const s = await foodSeedStatus(db);
  const todo = new Set([...s.missing, ...s.changed]);
  const written: string[] = [];
  for (const f of FOODS) {
    if (!todo.has(f.id)) continue;
    const row = foodRow(f);
    const cols = Object.keys(row);
    await query(
      `insert into public.foods (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       on conflict (id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}
       where public.foods.source = 'seed'`,
      Object.values(row),
      db,
    );
    written.push(f.id);
  }
  return { written };
}
