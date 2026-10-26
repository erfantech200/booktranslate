import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Experience } from '@coach/core/shared';
import { requireUser } from './supabase/server';
import type { Digits } from './format';

export interface Profile {
  user_id: string;
  onboarded_at: string | null;
  sex: 'male' | 'female' | null;
  birth_year: number | null;
  height_cm: number | null;
  experience: Experience | null;
  train_location: 'gym' | 'home' | null;
  equipment: string[];
  dumbbell_min_kg: number | null;
  dumbbell_max_kg: number | null;
  days_per_week: number | null;
  session_minutes: number | null;
  preferred_days: number[];
  injury_areas: string[];
  injury_notes: string | null;
  medical_notes: string | null;
  cardio_risk: boolean;
  daily_activity: 'sedentary' | 'light' | 'active' | null;
  cuisines: string[];
  disliked_foods: string | null;
  allergies: string | null;
  dietary_rules: string | null;
  cooking_minutes: number | null;
  budget: 'low' | 'medium' | 'high' | null;
  meals_per_day: number | null;
  appetite: 'low' | 'normal' | 'high' | null;
  start_date: string | null;
  start_weight_kg: number | null;
  target_gain_pct_week: number | null;
  target_weight_12m_kg: number | null;
  theme: 'dark' | 'light';
  digits: Digits;
}

const NUMERIC = ['height_cm', 'dumbbell_min_kg', 'dumbbell_max_kg', 'start_weight_kg', 'target_gain_pct_week', 'target_weight_12m_kg'] as const;

/** Signed-in user + profile (null before onboarding). Cached per request. */
export const loadProfile = cache(async () => {
  const { sb, user } = await requireUser();
  const { data } = await sb.from('profile').select('*').eq('user_id', user.id).maybeSingle();
  const profile = data ? (Object.fromEntries(Object.entries(data).map(([k, v]) =>
    [k, (NUMERIC as readonly string[]).includes(k) && v != null ? Number(v) : v])) as unknown as Profile) : null;
  return { sb, user, profile };
});

/** For pages inside the app shell: onboarding must be done first. */
export async function requireProfile() {
  const r = await loadProfile();
  if (!r.profile?.onboarded_at) redirect('/onboarding');
  return r as typeof r & { profile: Profile };
}
