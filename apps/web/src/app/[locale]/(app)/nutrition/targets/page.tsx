import { getTranslations, setRequestLocale } from 'next-intl/server';
import { COACH } from '@coach/core/shared';
import { fmtDate, fmtNum } from '@/lib/format';
import { ensureTargets } from '@/lib/nutrition';
import { requireProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

/** Where the numbers come from (deterministic engine), plus the only supplement info card (spec §9). */
export default async function TargetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('nutrition');
  const d = profile.digits;
  const nf = (n: number) => fmtNum(n, d);
  const target = await ensureTargets(sb, user.id, profile, await localToday());
  const rows: [string, string][] = [
    [t('kcal'), `${nf(target.kcal)} ${t('kcalUnit')}`],
    [t('protein'), `${nf(target.protein)} ${t('g')}`],
    [t('carbs'), `${nf(target.carbs)} ${t('g')}`],
    [t('fat'), `${nf(target.fat)} ${t('g')}`],
    [t('fiber'), `${nf(target.fiber)} ${t('g')}`],
    [t('water'), t('waterValue', { l: nf(target.waterMl / 1000), lt: nf((target.waterMl + COACH.nutrition.waterTrainingMl) / 1000) })],
  ];
  return (
    <div className="space-y-4 pt-2">
      <header className="rise">
        <h1 className="text-3xl font-extrabold">{t('targetsTitle')}</h1>
        <p className="text-sm text-muted">{t('since', { date: fmtDate(target.effectiveFrom, d, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
      </header>
      <dl className="card grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="num text-lg font-extrabold">{v}</dd></div>
        ))}
      </dl>
      <section className="card" aria-labelledby="how-h">
        <h2 id="how-h" className="card-title">{t('how')}</h2>
        <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-[0.9375rem]">
          <li>{t('bmrLine', { n: nf(target.bmr) })}</li>
          <li>{t('tdeeLine', { days: nf(profile.days_per_week ?? 3), f: fmtNum(target.factor, d, { maximumFractionDigits: 3 }), n: nf(target.tdee) })}</li>
          <li>{t('surplusLine', { n: nf(target.surplus) })}</li>
          <li>{t('proteinLine', { g: nf(COACH.nutrition.proteinGPerKg), kg: nf(target.weightKg), m: nf(Math.round(COACH.nutrition.proteinPerMealGPerKg * target.weightKg)) })}</li>
          <li>{t('fatLine', { g: nf(COACH.nutrition.fatGPerKg), pct: nf(COACH.nutrition.fatMinPctKcal) })}</li>
          <li>{t('carbLine')}</li>
          <li>{t('fiberLine', { g: nf(COACH.nutrition.fiberGPer1000Kcal), per: fmtNum(1000, d, { useGrouping: false }) })}</li>
          <li>{t('waterLine', { ml: nf(COACH.nutrition.waterMlPerKg), extra: nf(COACH.nutrition.waterTrainingMl) })}</li>
        </ol>
        <p className="field-hint">{t('adjustNote')}</p>
      </section>
      <section className="card" aria-labelledby="sup-h">
        <h2 id="sup-h" className="card-title">{t('supplementsTitle')}</h2>
        <p className="mt-2 text-[0.9375rem] leading-7 text-muted">{t('supplements', { min: nf(3), max: nf(5) })}</p>
      </section>
    </div>
  );
}
