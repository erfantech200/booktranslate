import { z } from 'zod';
import { COACH } from '../coach.config';

// Onboarding / Settings input. Shared by the client form and the server action (which re-validates).

export const EXPERIENCE = ['none', 'lt6m', '6to24m', 'gt2y'] as const;
export const EQUIPMENT = ['barbell', 'rack', 'bench', 'dumbbells', 'cables', 'machines', 'pullup_bar', 'bands'] as const;
export const BODY_AREAS = ['shoulder', 'elbow', 'wrist', 'lower_back', 'hip', 'knee', 'ankle'] as const;
export const CUISINES = ['persian', 'mediterranean', 'turkish', 'arabic', 'indian', 'east_asian', 'western'] as const;
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const; // 0 = Saturday (Persian week) … 6 = Friday

const P = COACH.profile;
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const optNum = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(min).max(max).optional());
const text = (max: number) => z.string().trim().max(max).optional().transform((s) => (s ? s : undefined));

export const ProfileFields = z.object({
  sex: z.enum(['male', 'female']),
  age: num(P.ageMin, P.ageMax).int(),
  heightCm: num(P.heightCmMin, P.heightCmMax),
  weightKg: num(P.weightKgMin, P.weightKgMax),
  waistCm: num(P.waistCmMin, P.waistCmMax),
  chestCm: optNum(50, 200),
  armCm: optNum(15, 70),
  thighCm: optNum(30, 110),

  experience: z.enum(EXPERIENCE),
  trainLocation: z.enum(['gym', 'home']),
  equipment: z.array(z.enum(EQUIPMENT)).default([]),
  dumbbellMinKg: optNum(0.5, 100),
  dumbbellMaxKg: optNum(0.5, 100),
  daysPerWeek: z.coerce.number().int().refine((n) => (P.daysPerWeek as readonly number[]).includes(n)),
  sessionMinutes: z.coerce.number().int().refine((n) => (P.sessionMinutes as readonly number[]).includes(n)),
  preferredDays: z.array(z.coerce.number().int().min(0).max(6)).default([]),

  injuryAreas: z.array(z.enum(BODY_AREAS)).default([]),
  injuryNotes: text(1000),
  medicalNotes: text(1000),
  cardioRisk: z.boolean().default(false),
  dailyActivity: z.enum(['sedentary', 'light', 'active']),

  cuisines: z.array(z.enum(CUISINES)).default(['persian']),
  dislikedFoods: text(500),
  allergies: text(500),
  dietaryRules: text(500),
  cookingMinutes: z.coerce.number().int().min(0).max(240),
  budget: z.enum(['low', 'medium', 'high']),
  mealsPerDay: z.coerce.number().int().refine((n) => (P.mealsPerDay as readonly number[]).includes(n)),
  appetite: z.enum(['low', 'normal', 'high']),

  targetGainPctWeek: optNum(COACH.gainRate.hardMin, COACH.gainRate.hardMax),
  targetWeight12mKg: optNum(P.weightKgMin, P.weightKgMax),
});

type Fields = z.infer<typeof ProfileFields>;

/** Cross-field rules (also run per wizard step, where zod would skip refinements of an incomplete form). */
export function profileCrossIssues(v: Partial<Fields>): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (v.trainLocation === 'home' && (v.equipment ?? []).length === 0) out.push({ path: 'equipment', message: 'equipment_required' });
  if (v.dumbbellMinKg !== undefined && v.dumbbellMaxKg !== undefined && v.dumbbellMinKg > v.dumbbellMaxKg) {
    out.push({ path: 'dumbbellMaxKg', message: 'range' });
  }
  if ((v.preferredDays ?? []).length > 0 && v.preferredDays!.length !== v.daysPerWeek) out.push({ path: 'preferredDays', message: 'match_days' });
  if (v.targetWeight12mKg !== undefined && v.weightKg !== undefined && v.targetWeight12mKg < v.weightKg) {
    out.push({ path: 'targetWeight12mKg', message: 'below_current' });
  }
  return out;
}

function rules(v: Partial<Fields>, ctx: z.RefinementCtx) {
  for (const i of profileCrossIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
}

/** Onboarding: everything, including today's body measurements. */
export const ProfileInput = ProfileFields.superRefine(rules);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const BODY_FIELDS = ['weightKg', 'waistCm', 'chestCm', 'armCm', 'thighCm'] as const;
/** Settings: the same fields minus body measurements (those change through weigh-ins). */
export const SettingsInput = ProfileFields.omit({ weightKg: true, waistCm: true, chestCm: true, armCm: true, thighCm: true }).superRefine(rules);
export type SettingsInput = z.infer<typeof SettingsInput>;
