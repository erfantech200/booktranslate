import { COACH } from '../coach.config';

// The daily supplement card (spec §9): creatine and protein powder only. Creatine is the same dose
// every day, training or not; protein powder is whatever that day's meal plan already contains.
// Vitamins and minerals come from food; the app never doses them.

const S = COACH.supplements;

export interface DaySupplements {
  /** null when there is no training plan to tell. */
  training: boolean | null;
  creatineG: number;
  /** Protein powder in the day's plan, or null when the plan has none. */
  proteinPowder: { grams: number; units: number | null; meals: string[] } | null;
}

export function daySupplements(o: {
  meals: readonly { nameFa: string; items: readonly { food: string; grams: number }[] }[];
  training: boolean | null;
  /** Grams in one household unit of the protein powder (a scoop), when known. */
  unitG?: number | null;
}): DaySupplements {
  let grams = 0;
  const meals: string[] = [];
  for (const m of o.meals) {
    const g = m.items.filter((i) => i.food === S.proteinPowderFood).reduce((a, i) => a + i.grams, 0);
    if (g > 0) { grams += g; meals.push(m.nameFa); }
  }
  return {
    training: o.training,
    creatineG: S.creatineGramsPerDay,
    proteinPowder: grams > 0 ? { grams: Math.round(grams), units: o.unitG ? Math.round((grams / o.unitG) * 2) / 2 : null, meals } : null,
  };
}

/**
 * Is `date` a training day? A finished or running workout that day says yes, a skipped one says
 * no; a past day with no workout was a rest day; a future day follows the block's training weekdays.
 */
export function isTrainingDate(o: {
  date: string;
  today: string;
  trainingWeekdays: readonly number[];
  sessions: readonly { date: string; status: 'active' | 'done' | 'skipped' }[];
}): boolean {
  const on = o.sessions.filter((s) => s.date === o.date);
  if (on.some((s) => s.status === 'done' || s.status === 'active')) return true;
  if (on.length || o.date < o.today) return false;
  const wd = (new Date(`${o.date}T00:00:00Z`).getUTCDay() + 1) % 7; // 0 = Saturday
  return o.trainingWeekdays.includes(wd);
}
