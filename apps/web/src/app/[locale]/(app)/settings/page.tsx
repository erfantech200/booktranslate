import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileForm, type FormValues } from '@/components/ProfileForm';
import { saveDisplay } from '@/lib/profileActions';
import { requireProfile, type Profile } from '@/lib/profile';
import { loadWeighIns } from '@/lib/weights';
import { signOut } from '../../actions';

export const dynamic = 'force-dynamic';

function toForm(p: Profile): FormValues {
  const s = (n: number | null | undefined) => (n == null ? '' : String(n));
  return {
    sex: p.sex ?? '', age: s(p.birth_year ? new Date().getFullYear() - p.birth_year : null), heightCm: s(p.height_cm),
    experience: p.experience ?? '', trainLocation: p.train_location ?? '', equipment: p.equipment,
    dumbbellMinKg: s(p.dumbbell_min_kg), dumbbellMaxKg: s(p.dumbbell_max_kg),
    daysPerWeek: s(p.days_per_week), sessionMinutes: s(p.session_minutes), preferredDays: p.preferred_days.map(String),
    injuryAreas: p.injury_areas, injuryNotes: p.injury_notes ?? '', cardioRisk: p.cardio_risk, medicalNotes: p.medical_notes ?? '',
    dailyActivity: p.daily_activity ?? '', cuisines: p.cuisines, dislikedFoods: p.disliked_foods ?? '', allergies: p.allergies ?? '',
    dietaryRules: p.dietary_rules ?? '', cookingMinutes: s(p.cooking_minutes), budget: p.budget ?? '', mealsPerDay: s(p.meals_per_day),
    appetite: p.appetite ?? '', targetGainPctWeek: s(p.target_gain_pct_week), targetWeight12mKg: s(p.target_weight_12m_kg),
  };
}

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('settings');
  const tn = await getTranslations('nav');
  const tc = await getTranslations('common');
  const latest = (await loadWeighIns(sb)).at(-1)?.weightKg ?? profile.start_weight_kg;

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-extrabold">{t('title')}</h1>

      <form action={saveDisplay} className="card space-y-5">
        <h2 className="text-xl font-extrabold">{t('appearance')}</h2>
        <fieldset>
          <legend className="field-label">{t('theme')}</legend>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((th) => (
              <label key={th} className="chip"><input type="radio" name="theme" value={th} defaultChecked={profile.theme === th} />{t(th)}</label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="field-label">{t('digits')}</legend>
          <div className="flex gap-2">
            {(['latin', 'persian'] as const).map((dg) => (
              <label key={dg} className="chip"><input type="radio" name="digits" value={dg} defaultChecked={profile.digits === dg} />{t(dg)}</label>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-secondary">{tc('save')}</button>
      </form>

      <h2 className="pt-4 text-xl font-extrabold">{t('profile')}</h2>
      <ProfileForm mode="page" initial={toForm(profile)} currentWeightKg={latest} startWeightKg={profile.start_weight_kg} />

      <section className="card space-y-3">
        <h2 className="text-xl font-extrabold">{t('account')}</h2>
        <p className="text-sm" dir="ltr">{user.email}</p>
        <p className="field-hint mt-0">{t('passwordNote')}</p>
        <form action={signOut}><button className="btn btn-secondary">{tn('signOut')}</button></form>
      </section>
    </div>
  );
}
