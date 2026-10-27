import { getTranslations, setRequestLocale } from 'next-intl/server';
import { weekday } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { LogBox } from '@/components/nutrition/LogBox';
import { MealCard } from '@/components/nutrition/MealCard';
import { PlanStatus } from '@/components/nutrition/PlanStatus';
import { ProteinNudge } from '@/components/nutrition/ProteinNudge';
import { MacroBars, Rings } from '@/components/nutrition/Rings';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { fmtDate, fmtNum } from '@/lib/format';
import { mealView } from '@/lib/mealView';
import { ensureTargets, foodMap, loadDayLogs, loadPlan, sumLogs, weekStartOf } from '@/lib/nutrition';
import { deleteLogEntry, requestPlan } from '@/lib/nutritionActions';
import { requireProfile } from '@/lib/profile';
import { localTimeZone, localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

export default async function NutritionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('nutrition');
  const d = profile.digits;
  const nf = (n: number) => fmtNum(Math.round(n), d);
  const today = await localToday();
  const timeZone = await localTimeZone();
  const [target, plan, logs, foods] = await Promise.all([
    ensureTargets(sb, user.id, profile, today), loadPlan(sb, weekStartOf(today)), loadDayLogs(sb, today), foodMap(),
  ]);
  const eaten = sumLogs(logs);
  const meals = plan?.status === 'ready' ? plan.meals.filter((m) => m.dayIdx === weekday(today)) : [];
  const eatenMeals = new Set(logs.map((l) => l.mealId).filter(Boolean));
  const entries = [...new Map(logs.map((l) => [l.entryId, logs.filter((x) => x.entryId === l.entryId)])).values()];

  return (
    <div className="space-y-4 pt-2">
      <header className="rise">
        <p className="text-muted">{fmtDate(today, d, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-3xl font-extrabold">{t('title')}</h1>
      </header>

      <section className="card rise space-y-4" aria-label={t('targetsTitle')}>
        <Rings kcal={{ value: eaten.kcal, target: target.kcal }} protein={{ value: eaten.protein, target: target.protein }} digits={d}
          labels={{ kcal: t('kcal'), protein: t('protein'), g: t('g'), of: (x) => t('ofTarget', { target: x }), left: (n) => t('left', { n }), over: (n) => t('over', { n }) }} />
        <MacroBars digits={d} rows={[
          { label: `${t('carbs')} (${t('g')})`, value: eaten.carbs, target: target.carbs },
          { label: `${t('fat')} (${t('g')})`, value: eaten.fat, target: target.fat },
          { label: `${t('fiber')} (${t('g')})`, value: eaten.fiber, target: target.fiber },
        ]} />
        <p className="text-xs text-muted">{t('water')}: {t('waterValue', { l: fmtNum(target.waterMl / 1000, d), lt: fmtNum((target.waterMl + 500) / 1000, d) })}</p>
      </section>
      <ProteinNudge protein={eaten.protein} target={target.protein} digits={d} />

      {!plan || plan.status === 'failed' ? (
        <section className="card" aria-labelledby="plan-h">
          <h2 id="plan-h" className="card-title">{t('noPlanTitle')}</h2>
          {plan?.status === 'failed'
            ? <p className="note note-danger mt-2">{plan.error === 'budget' ? t('planFailedBudget') : t('planFailed')}</p>
            : <p className="mt-2 text-muted">{t('noPlan')}</p>}
          <form action={requestPlan.bind(null, true)} className="mt-4"><ConfirmSubmit className="btn btn-primary w-full">{plan ? t('retry') : t('makePlan')}</ConfirmSubmit></form>
        </section>
      ) : plan.status === 'pending' ? (
        <section className="card" aria-busy="true">
          <h2 className="card-title">{t('noPlanTitle')}</h2>
          <p className="mt-2 animate-pulse text-muted">{t('planPending')}</p>
          <PlanStatus planId={plan.id} />
        </section>
      ) : (
        <section aria-labelledby="meals-h">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="meals-h" className="card-title">{t('todayMeals')}</h2>
            <Link href="/nutrition/plan" className="text-sm text-accent-text">{t('weekPlan')}</Link>
          </div>
          <ul className="space-y-2">
            {meals.map((m) => <MealCard key={m.id} meal={mealView(m, foods, d)} eaten={eatenMeals.has(m.id)} digits={d} />)}
          </ul>
        </section>
      )}

      <LogBox digits={d} />

      <section className="card" aria-labelledby="log-today-h">
        <h2 id="log-today-h" className="card-title">{t('todayLog')}</h2>
        {entries.length === 0 ? <p className="mt-2 text-sm text-muted">{t('nothingLogged')}</p> : (
          <ul className="mt-2 divide-y divide-line">
            {entries.map((rows) => {
              const m = sumLogs(rows);
              const first = rows[0]!;
              return (
                <li key={first.entryId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-medium">
                      <span className="truncate">{first.source === 'plan' ? first.label : rows.map((r) => foods.get(r.food)?.nameFa ?? r.food).join('، ')}</span>
                      {rows.some((r) => r.estimated) && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] text-accent-text">{t('estimate')}</span>}
                    </p>
                    <p className="num text-xs text-muted">
                      {new Date(first.loggedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone, numberingSystem: d === 'latin' ? 'latn' : 'arabext' })}
                      {' · '}{nf(m.kcal)} {t('kcalUnit')} · {nf(m.protein)} {t('g')} {t('protein')}{first.source === 'plan' ? ` · ${t('fromPlan')}` : ''}
                    </p>
                  </div>
                  <form action={deleteLogEntry.bind(null, first.entryId)}>
                    <button className="btn btn-ghost min-h-9 px-2 text-sm" aria-label={t('remove')}>✕</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-2" aria-label={t('title')}>
        <Link href="/nutrition/grocery" className="btn btn-secondary">{t('grocery')}</Link>
        <Link href="/nutrition/targets" className="btn btn-secondary">{t('targets')}</Link>
      </nav>
    </div>
  );
}
