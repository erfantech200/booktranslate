import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileForm, type FormValues } from '@/components/ProfileForm';
import { COACH, env } from '@coach/core';
import { checkinWeekday } from '@/lib/checkin';
import { fmtNum } from '@/lib/format';
import { startExerciseImages } from '@/lib/imageActions';
import { saveCheckinDay, saveDisplay } from '@/lib/profileActions';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
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
  const tck = await getTranslations('checkin');
  const weekdays = (await getTranslations('profile')).raw('weekday') as string[];
  const d = profile.digits;
  // AI spend this month (spec §15), from ai_usage (the owner's own rows, RLS).
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data: usage }, { data: ex }, { data: job }] = await Promise.all([
    sb.from('ai_usage').select('feature, cost_usd, ok').gte('created_at', monthStart.toISOString()),
    sb.from('exercises').select('image_status'),
    sb.from('jobs').select('id').eq('type', 'exercise_images').in('status', ['queued', 'running']).limit(1).maybeSingle(),
  ]);
  const cap = env().OPENAI_MONTHLY_BUDGET_USD;
  const spent = (usage ?? []).reduce((a, r) => a + Number(r.cost_usd), 0);
  const groups = new Map<string, { feature: string; calls: number; cost: number }>();
  for (const r of usage ?? []) {
    const g = groups.get(r.feature) ?? { feature: r.feature, calls: 0, cost: 0 };
    g.calls++; g.cost += Number(r.cost_usd); groups.set(r.feature, g);
  }
  const byFeature = [...groups.values()].sort((a, b) => b.cost - a.cost);
  const imagesMonth = (usage ?? []).filter((r) => r.feature === 'exercise_image' && r.ok).length;
  const imgTotal = (ex ?? []).length, imgOk = (ex ?? []).filter((r) => r.image_status === 'ok').length, imgFlagged = (ex ?? []).filter((r) => r.image_status === 'flagged').length;
  const imgJob = !!job;

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

      <form action={saveCheckinDay} className="card space-y-3">
        <h2 className="text-xl font-extrabold">{tck('weekday')}</h2>
        <p className="field-hint mt-0">{t('checkinHint')}</p>
        <div className="flex flex-wrap gap-2">
          {weekdays.map((w, i) => (
            <label key={i} className="chip"><input type="radio" name="checkinWeekday" value={i} defaultChecked={checkinWeekday(profile) === i} />{w}</label>
          ))}
        </div>
        <button className="btn btn-secondary">{tc('save')}</button>
      </form>

      <section className="card space-y-3" aria-labelledby="ai-h">
        <h2 id="ai-h" className="text-xl font-extrabold">{t('aiTitle')}</h2>
        <p className="num text-lg font-bold" dir="ltr" style={{ textAlign: 'right' }}>${fmtNum(spent, d, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${fmtNum(cap, d)}</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={t('aiTitle')} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.round(spent * 100) / 100}>
          <div className={`h-full rounded-full ${spent >= cap ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.min(100, cap > 0 ? (spent / cap) * 100 : 100)}%` }} />
        </div>
        <p className="field-hint mt-0">{spent >= cap ? t('aiOver') : t('aiHint')}</p>
        {byFeature.length > 0 && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {byFeature.map((f) => (
                <tr key={f.feature}>
                  <td className="py-1.5">{t.has(`aiFeature.${f.feature}`) ? t(`aiFeature.${f.feature}`) : f.feature}</td>
                  <td className="num py-1.5 text-end text-muted">{fmtNum(f.calls, d)}×</td>
                  <td className="num py-1.5 text-end" dir="ltr">${fmtNum(f.cost, d, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="field-hint mt-0">{t('aiImages', { n: fmtNum(imagesMonth, d), max: fmtNum(COACH.exerciseImages.maxPerMonth, d) })}</p>
      </section>

      <section className="card space-y-3" aria-labelledby="img-h">
        <h2 id="img-h" className="text-xl font-extrabold">{t('imagesTitle')}</h2>
        <p className="text-sm text-muted">{t('imagesStatus', { ok: fmtNum(imgOk, d), total: fmtNum(imgTotal, d), flagged: fmtNum(imgFlagged, d) })}</p>
        {imgJob ? <p className="note note-info text-sm">{t('imagesRunning')}</p> : imgOk + imgFlagged < imgTotal && (
          <form action={startExerciseImages}>
            <ConfirmSubmit className="btn btn-secondary w-full" confirm={t('imagesConfirm', { n: fmtNum(imgTotal - imgOk - imgFlagged, d) })}>{t('imagesStart')}</ConfirmSubmit>
          </form>
        )}
        <p className="field-hint mt-0">{t('imagesHint')}</p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-xl font-extrabold">{t('account')}</h2>
        <p className="text-sm" dir="ltr">{user.email}</p>
        <p className="field-hint mt-0">{t('passwordNote')}</p>
        <form action={signOut}><button className="btn btn-secondary">{tn('signOut')}</button></form>
      </section>
    </div>
  );
}
