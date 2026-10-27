import { getTranslations, setRequestLocale } from 'next-intl/server';
import { WeighInCard } from '@/components/WeighInCard';
import { fmtDate, fmtNum } from '@/lib/format';
import { planSummary } from '@/lib/plan';
import { requireProfile } from '@/lib/profile';
import { loadWeighIns } from '@/lib/weights';
import { Link } from '@/i18n/navigation';
import { loadMeasurements } from '@/lib/progress';
import { localToday } from '@/lib/today';
import { loadActiveMeso, loadSessions, weekView } from '@/lib/training';
import { measurementStatus, photoStatus, weekday } from '@coach/core/shared';
import { MealCard } from '@/components/nutrition/MealCard';
import { mealView } from '@/lib/mealView';
import { ensureTargets, foodMap, loadDayLogs, loadPlan, sumLogs, weekStartOf } from '@/lib/nutrition';

export const dynamic = 'force-dynamic';

export default async function TodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('today');
  const tn = await getTranslations('nutrition');
  const tw = await getTranslations('workout');
  const today = await localToday();
  const [weighIns, block, { data: active }, measurements, { data: lastPhoto }] = await Promise.all([
    loadWeighIns(sb), loadActiveMeso(sb), sb.from('workout_sessions').select('id').eq('status', 'active').maybeSingle(),
    loadMeasurements(sb), sb.from('progress_photos').select('taken_on').order('taken_on', { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Two-weekly measurement and photo reminders.
  const measureDue = measurementStatus(measurements, today).due;
  const photosDue = photoStatus(lastPhoto ? [lastPhoto.taken_on] : [], today).due;
  const s = planSummary(profile, weighIns, today);
  const [target, plan, logs, foods] = await Promise.all([
    ensureTargets(sb, user.id, profile, today), loadPlan(sb, weekStartOf(today)), loadDayLogs(sb, today), foodMap(),
  ]);
  const eaten = sumLogs(logs);
  const eatenMeals = new Set(logs.map((l) => l.mealId).filter(Boolean));
  const todayMeals = plan?.status === 'ready' ? plan.meals.filter((m) => m.dayIdx === weekday(today)) : [];
  const view = block ? weekView(block.meso, block.days, await loadSessions(sb, block.meso.id), today) : null;
  const nextDay = view?.state.next ? block!.days[view.state.next.dayIdx] : null;
  const d = profile.digits;
  const gained = s.current != null ? Math.max(0, s.current - s.startKg) : 0;
  const total = s.target12m - s.startKg;
  const pct = total > 0 ? Math.min(100, (gained / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <header className="rise pt-2 pb-2">
        <p className="text-muted">{fmtDate(today, d, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-3xl font-extrabold">{t('greeting')}</h1>
        <p className="mt-1 text-sm text-muted num">{t('day', { n: fmtNum(Math.min(365, s.dayNumber), d), total: fmtNum(365, d) })}</p>
      </header>

      {profile.cardio_risk && <p role="note" className="note note-warn">{t('clearance')}</p>}

      <section className="card" aria-labelledby="wk-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="wk-h" className="card-title">{t('workoutTitle')}</h2>
          {view?.state.next && !active && (
            <span className="text-sm text-muted">{view.state.dueToday || view.state.late ? tw('todayTitle') : tw('plannedFor', { date: fmtDate(view.state.next.planned, d, { weekday: 'long' }) })}</span>
          )}
        </div>
        {active ? (
          <Link href="/gym" className="btn btn-primary mt-3 w-full">{tw('resume')}</Link>
        ) : !block ? (
          <>
            <p className="mt-1 text-sm text-muted">{tw('noBlockTitle')}</p>
            <Link href="/workout" className="btn btn-secondary mt-3 w-full">{tw('build')}</Link>
          </>
        ) : view?.over ? (
          <Link href="/workout" className="btn btn-secondary mt-3 w-full">{tw('nextBlock')}</Link>
        ) : nextDay ? (
          <Link href="/workout" className="mt-2 flex items-center justify-between gap-3">
            <span className="text-2xl font-extrabold">{tw(`days.${nextDay.kind}`)}</span>
            <span className={`btn ${view!.state.dueToday || view!.state.late ? 'btn-primary' : 'btn-secondary'} min-h-10`}>{view!.state.late ? tw('lateTitle') : tw('start')}</span>
          </Link>
        ) : <p className="mt-1 text-sm text-muted">{tw('weekDone')}</p>}
      </section>

      {(measureDue || photosDue) && (
        <Link href={measureDue ? '/progress/body#measure' : '/progress/photos/new'} className="note note-warn flex items-center justify-between gap-3">
          <span>{measureDue && photosDue ? t('dueBoth') : measureDue ? t('dueMeasure') : t('duePhotos')}</span>
          <span className="shrink-0 font-bold">{t('dueGo')}</span>
        </Link>
      )}

      <WeighInCard recent={weighIns.slice(-14).map(({ date, weightKg }) => ({ date, weightKg }))} avg7={s.current} digits={d} />

      <section className="card" aria-labelledby="goal-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="goal-h" className="card-title">{t('goal')}</h2>
          <span className="text-sm text-muted num">{t('goalRange', { from: fmtNum(s.startKg, d), to: fmtNum(s.target12m, d) })}</span>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm num">{t('towardGoal', { done: fmtNum(gained, d), total: fmtNum(total, d) })}</p>
        <p className="field-hint">{t('goalNote')}</p>
      </section>

      <section className="card" aria-labelledby="nut-h">
        <h2 id="nut-h" className="card-title">{t('nutritionTitle')}</h2>
        <Link href="/nutrition" className="num mt-1 block text-sm text-muted">
          {fmtNum(Math.round(eaten.kcal), d)} / {fmtNum(target.kcal, d)} {tn('kcalUnit')} · {fmtNum(Math.round(eaten.protein), d)} / {fmtNum(target.protein, d)} {tn('g')} {tn('protein')}
        </Link>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={tn('kcal')} aria-valuemin={0} aria-valuemax={target.kcal} aria-valuenow={Math.round(eaten.kcal)}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (eaten.kcal / target.kcal) * 100)}%` }} />
        </div>
        {todayMeals.length > 0 ? (
          <ul className="mt-2 divide-y divide-line">
            {todayMeals.map((m) => <MealCard key={m.id} meal={mealView(m, foods, d)} eaten={eatenMeals.has(m.id)} digits={d} compact />)}
          </ul>
        ) : (
          <Link href="/nutrition" className="btn btn-secondary mt-3 w-full">{plan?.status === 'pending' ? tn('planPending') : tn('makePlan')}</Link>
        )}
      </section>
    </div>
  );
}
