import { getTranslations, setRequestLocale } from 'next-intl/server';
import { addDays, dayMacros, weekday } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { MealCard } from '@/components/nutrition/MealCard';
import { PlanStatus } from '@/components/nutrition/PlanStatus';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { fmtDate, fmtNum } from '@/lib/format';
import { mealView } from '@/lib/mealView';
import { ensureTargets, foodMap, loadDayLogs, loadPlan, planDays, weekStartOf } from '@/lib/nutrition';
import { requestPlan } from '@/lib/nutritionActions';
import { requireProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

/** The week's plan, one day at a time (?day=0…6, Saturday first). */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ day?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('nutrition');
  const weekdays = (await getTranslations('profile')).raw('weekday') as string[];
  const d = profile.digits;
  const nf = (n: number) => fmtNum(Math.round(n), d);
  const today = await localToday();
  const weekStart = weekStartOf(today);
  const [target, plan, foods, logs] = await Promise.all([ensureTargets(sb, user.id, profile, today), loadPlan(sb, weekStart), foodMap(), loadDayLogs(sb, today)]);
  const sel = Math.min(6, Math.max(0, Number((await searchParams).day ?? weekday(today)) || 0));
  const date = addDays(weekStart, sel);

  if (!plan || plan.status !== 'ready') {
    return (
      <div className="space-y-4 pt-2">
        <h1 className="text-3xl font-extrabold">{t('weekPlan')}</h1>
        {plan?.status === 'pending' ? (
          <p className="card animate-pulse text-muted">{t('planPending')}<PlanStatus planId={plan.id} /></p>
        ) : (
          <form action={requestPlan.bind(null, true)} className="card">
            <p className="text-muted">{plan?.status === 'failed' ? t('planFailed') : t('noPlan')}</p>
            <ConfirmSubmit className="btn btn-primary mt-4 w-full">{t('makePlan')}</ConfirmSubmit>
          </form>
        )}
      </div>
    );
  }

  const days = planDays(plan);
  const meals = plan.meals.filter((m) => m.dayIdx === sel);
  const total = dayMacros(days[sel]!, foods);
  const eatenMeals = new Set(logs.map((l) => l.mealId).filter(Boolean));
  return (
    <div className="space-y-4 pt-2">
      <header className="rise flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold">{t('weekPlan')}</h1>
        <Link href="/nutrition/grocery" className="text-sm text-accent-text">{t('grocery')}</Link>
      </header>
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4" aria-label={t('weekPlan')}>
        {weekdays.map((w, i) => (
          <Link key={i} href={`/nutrition/plan?day=${i}`} aria-current={i === sel ? 'page' : undefined}
            className={`grid min-w-14 shrink-0 place-items-center rounded-xl border px-2 py-1.5 text-center ${i === sel ? 'border-accent bg-accent-soft text-accent-text' : 'border-line bg-surface'}`}>
            <span className="text-xs font-bold">{w}</span>
            <span className="num text-[0.6875rem] text-muted">{fmtDate(addDays(weekStart, i), d, { day: 'numeric' })}</span>
          </Link>
        ))}
      </nav>
      <section className="card">
        <p className="text-sm text-muted">{fmtDate(date, d, { weekday: 'long', day: 'numeric', month: 'long' })} · {t('dayTotal')}</p>
        <p className="num mt-1 font-bold">
          {nf(total.kcal)} / {nf(target.kcal)} {t('kcalUnit')} · {nf(total.protein)} / {nf(target.protein)} {t('g')} {t('protein')}
        </p>
        <p className="num text-xs text-muted">{t('carbs')} {nf(total.carbs)} · {t('fat')} {nf(total.fat)} · {t('fiber')} {nf(total.fiber)} {t('g')}</p>
      </section>
      <ul className="space-y-2">
        {meals.map((m) => <MealCard key={m.id} meal={mealView(m, foods, d)} eaten={date === today && eatenMeals.has(m.id)} digits={d} interactive={date === today} />)}
      </ul>
      {plan.warnings.length > 0 && <p className="note note-info text-sm">{t('warnings', { n: fmtNum(plan.warnings.length, d) })}</p>}
      <form action={requestPlan.bind(null, true)} className="text-center">
        <ConfirmSubmit className="btn btn-ghost text-sm" confirm={t('regenerateConfirm')}>{t('regenerate')}</ConfirmSubmit>
      </form>
    </div>
  );
}
