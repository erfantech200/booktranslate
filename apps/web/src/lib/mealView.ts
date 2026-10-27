import 'server-only';
import type { Food } from '@coach/core/shared';
import type { MealView } from '@/components/nutrition/MealCard';
import { fmtNum, type Digits } from './format';
import type { MealRow } from './nutrition';

/** A planned meal ready for MealCard: names and household units resolved on the server. */
export function mealView(m: MealRow, foods: ReadonlyMap<string, Food>, digits: Digits): MealView {
  return {
    id: m.id, slot: m.slot, nameFa: m.nameFa, cookMinutes: m.cookMinutes, kcal: m.kcal, protein: m.protein,
    items: m.items.map((i) => {
      const f = foods.get(i.food);
      const unit = f?.whole && f.unit ? `${fmtNum(Math.round(i.grams / f.unit.g), digits)} ${f.unit.fa}` : null;
      return { name: f?.nameFa ?? i.food, grams: i.grams, unit };
    }),
  };
}
