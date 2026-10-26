'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ProfileInput, SettingsInput, type ProfileInput as PI } from '@coach/core/shared';
import { normalizeDigits } from './digits';
import { sanitizeLocalDate } from './format';
import { loadProfile } from './profile';

export type SaveResult = { ok: true } | { ok: false; issues: { path: string; code: string }[] };

const issuesOf = (e: { issues: { path: PropertyKey[]; message: string; code: string }[] }) =>
  e.issues.map((i) => ({ path: String(i.path[0] ?? ''), code: i.code === 'custom' ? i.message : 'invalid' }));

function profileRow(v: Omit<PI, 'weightKg' | 'waistCm' | 'chestCm' | 'armCm' | 'thighCm'>, localDate: string) {
  return {
    sex: v.sex,
    birth_year: Number(localDate.slice(0, 4)) - v.age,
    height_cm: v.heightCm,
    experience: v.experience,
    train_location: v.trainLocation,
    equipment: v.trainLocation === 'gym' ? [] : v.equipment,
    dumbbell_min_kg: v.dumbbellMinKg ?? null,
    dumbbell_max_kg: v.dumbbellMaxKg ?? null,
    days_per_week: v.daysPerWeek,
    session_minutes: v.sessionMinutes,
    preferred_days: v.preferredDays,
    injury_areas: v.injuryAreas,
    injury_notes: v.injuryNotes ?? null,
    medical_notes: v.medicalNotes ?? null,
    cardio_risk: v.cardioRisk,
    daily_activity: v.dailyActivity,
    cuisines: v.cuisines,
    disliked_foods: v.dislikedFoods ?? null,
    allergies: v.allergies ?? null,
    dietary_rules: v.dietaryRules ?? null,
    cooking_minutes: v.cookingMinutes,
    budget: v.budget,
    meals_per_day: v.mealsPerDay,
    appetite: v.appetite,
    target_gain_pct_week: v.targetGainPctWeek ?? null,
    target_weight_12m_kg: v.targetWeight12mKg ?? null,
  };
}

/** Onboarding: profile + today's body measurements; the plan starts today. */
export async function saveOnboarding(raw: unknown, localDate: unknown): Promise<SaveResult> {
  const parsed = ProfileInput.safeParse(normalizeDigits(raw));
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const v = parsed.data;
  const date = sanitizeLocalDate(localDate);
  const { sb, user, profile } = await loadProfile();
  const { error } = await sb.from('profile').upsert({
    user_id: user.id,
    ...profileRow(v, date),
    onboarded_at: profile?.onboarded_at ?? new Date().toISOString(),
    start_date: profile?.start_date ?? date,
    start_weight_kg: profile?.start_weight_kg ?? v.weightKg,
  });
  if (error) throw new Error(error.message);
  const { error: me } = await sb.from('body_metrics').upsert({
    user_id: user.id, date, weight_kg: v.weightKg, waist_cm: v.waistCm,
    chest_cm: v.chestCm ?? null, arm_cm: v.armCm ?? null, thigh_cm: v.thighCm ?? null,
  }, { onConflict: 'user_id,date' });
  if (me) throw new Error(me.message);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Settings: everything except body measurements. Start date and start weight stay fixed. */
export async function saveSettings(raw: unknown): Promise<SaveResult> {
  const parsed = SettingsInput.safeParse(normalizeDigits(raw));
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const { sb, user } = await loadProfile();
  const { error } = await sb.from('profile').update(profileRow(parsed.data, new Date().toISOString().slice(0, 10))).eq('user_id', user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function saveDisplay(form: FormData) {
  const theme = form.get('theme') === 'light' ? 'light' : 'dark';
  const digits = form.get('digits') === 'persian' ? 'persian' : 'latin';
  const { sb, user } = await loadProfile();
  const { error } = await sb.from('profile').update({ theme, digits }).eq('user_id', user.id);
  if (error) throw new Error(error.message);
  (await cookies()).set('theme', theme, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 400 * 86_400 });
  revalidatePath('/', 'layout');
}
