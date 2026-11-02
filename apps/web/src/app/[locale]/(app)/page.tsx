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
import { addDays, COACH, daySupplements, measurementStatus, photoStatus, weekday } from '@coach/core/shared';
import { MealCard } from '@/components/nutrition/MealCard';
import { SupplementCard } from '@/components/nutrition/SupplementCard';
import { loadSupplementDays } from '@/lib/supplements';
import { ensureCheckin } from '@/lib/checkin';
import { loadEngagement } from '@/lib/engagement';
import { librarySlugMap } from '@/lib/library';
import { IconTrophy } from '@/components/icons';
import type { TipTopic } from '@coach/core/shared';
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
  const [target, plan, logs, foods, sups] = await Promise.all([
    ensureTargets(sb, user.id, profile, today), loadPlan(sb, weekStartOf(today)), loadDayLogs(sb, today), foodMap(), loadSupplementDays(sb, [today], today),
  ]);
  const eaten = sumLogs(logs);
  const eatenMeals = new Set(logs.map((l) => l.mealId).filter(Boolean));
  const todayMeals = plan?.status === 'ready' ? plan.meals.filter((m) => m.dayIdx === weekday(today)) : [];
  const powder = foods.get(COACH.supplements.proteinPowderFood);
  const sup = daySupplements({ meals: todayMeals, training: sups.training.get(today) ?? null, unitG: powder?.unit?.g });
  const te = await getTranslations('engagement');
  const tips = te.raw('tips') as Record<TipTopic, string[]>;
  const [eng, checkin, bySlug] = await Promise.all([
    loadEngagement(sb, profile, today, weighIns, Object.fromEntries(Object.entries(tips).map(([k, v]) => [k, v.length]))),
    ensureCheckin(sb, user.id, profile, today, target.surplus),
    librarySlugMap(),
  ]);
  const { count: checkinPending } = checkin
    ? await sb.from('adjustments').select('id', { count: 'exact', head: true }).eq('checkin_id', checkin.id).eq('status', 'proposed')
    : { count: 0 };
  const showCheckin = !!checkin && ((checkinPending ?? 0) > 0 || checkin.weekEnd >= addDays(today, -2));
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

      {showCheckin && checkin && (
        <Link href={`/coach/checkin/${checkin.id}`} className="card flex items-center justify-between gap-3 border-accent hover:border-accent">
          <span>
            <b className="block">{te('checkinReady')}</b>
            <span className="text-sm text-muted">{te('checkinReadyHint', { n: checkinPending ?? 0, count: fmtNum(checkinPending ?? 0, d) })}</span>
          </span>
          <span aria-hidden="true" className="text-2xl text-accent-text">‹</span>
        </Link>
      )}

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

      {eng.trainingToday && !eng.readinessLogged && !active && (
        <Link href="/workout#readiness" className="note note-info flex items-center justify-between gap-3">
          <span>{te('readinessPrompt')}</span>
          <span className="shrink-0 font-bold">{t('dueGo')}</span>
        </Link>
      )}

      <section className="card" aria-labelledby="tip-h">
        <h2 id="tip-h" className="card-title">{te('tipTitle')}</h2>
        <p className="mt-2 leading-7">{tips[eng.tip.topic]?.[eng.tip.variant] ?? tips.general[0]}</p>
      </section>

      {(measureDue || photosDue) && (
        <Link href={measureDue ? '/progress/body#measure' : '/progress/photos/new'} className="note note-warn flex items-center justify-between gap-3">
          <span>{measureDue && photosDue ? t('dueBoth') : measureDue ? t('dueMeasure') : t('duePhotos')}</span>
          <span className="shrink-0 font-bold">{t('dueGo')}</span>
        </Link>
      )}

      <WeighInCard recent={weighIns.slice(-14).map(({ date, weightKg }) => ({ date, weightKg }))} avg7={s.current} digits={d} />

      <section className="card" aria-labelledby="streak-h">
        <h2 id="streak-h" className="card-title">{te('streakTitle')}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {([['streakWeigh', eng.streaks.weigh], ['streakFood', eng.streaks.food], ['streakCreatine', eng.streaks.creatine]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-2 py-3">
              <dd className="num text-2xl font-extrabold">{fmtNum(v, d)}<span className="ms-1 text-xs font-normal text-muted">{te('days')}</span></dd>
              <dt className="mt-0.5 text-xs text-muted">{te(k)}</dt>
            </div>
          ))}
        </dl>
        {eng.badges.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-bold">{te('badgesTitle')}</h3>
            <ul className="mt-2 space-y-1.5">
              {eng.badges.map((b) => (
                <li key={b.kind} className="flex items-center gap-2 text-sm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text"><IconTrophy className="h-4 w-4" /></span>
                  {b.kind === 'perfect_week' ? te('badges.perfect_week', { n: fmtNum(b.workouts, d) })
                    : b.kind === 'protein_streak' ? te('badges.protein_streak', { n: fmtNum(b.days, d) })
                      : b.kind === 'new_lift' ? te('badges.new_lift', { names: b.slugs.map((x) => bySlug.get(x)?.nameFa ?? x).join('، ') })
                        : te('badges.weigh_week')}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

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

      <SupplementCard sup={sup} isToday taken={sups.taken.has(today)} streak={sups.streak} unitFa={powder?.unit?.fa ?? null} digits={d} compact />
    </div>
  );
}
