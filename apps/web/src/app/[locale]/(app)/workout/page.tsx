import { getTranslations, setRequestLocale } from 'next-intl/server';
import { plannedDates, sessionMinutes, setsFor, weekContext, weekday, type DayKind } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { LocalDate } from '@/components/workout/LocalDate';
import { ReadinessCard } from '@/components/workout/ReadinessCard';
import { fmtDate, fmtNum } from '@/lib/format';
import { loadLibrary } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';
import { earlyDeloadCheck, holdRampFor, isoMinusDays, loadActiveMeso, loadReadiness, loadSessions, mesoInfo, todayIsLow, weekView } from '@/lib/training';
import { acceptEarlyDeload, createBlock, skipDay, startWorkout } from '@/lib/workoutActions';

export const dynamic = 'force-dynamic';

export default async function WorkoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('workout');
  const weekdays = (await getTranslations('profile')).raw('weekday') as string[];
  const d = profile.digits;
  const today = await localToday();
  const block = await loadActiveMeso(sb);
  const { data: active } = await sb.from('workout_sessions').select('id, plan->kinds').eq('status', 'active').maybeSingle();

  const libraryLink = (
    <Link href="/workout/library" className="card flex items-center justify-between gap-3 hover:border-muted">
      <span><b className="block">{t('library')}</b><span className="text-sm text-muted">{t('libraryHint')}</span></span>
      <span aria-hidden="true" className="text-2xl text-muted">‹</span>
    </Link>
  );

  if (!block) {
    return (
      <div className="space-y-4 pt-2">
        <h1 className="text-3xl font-extrabold">{t('title')}</h1>
        <section className="card rise">
          <h2 className="card-title">{t('noBlockTitle')}</h2>
          <p className="mt-2 text-muted">{t('noBlock', { days: fmtNum(profile.days_per_week ?? 3, d), minutes: fmtNum(profile.session_minutes ?? 60, d) })}</p>
          <form action={createBlock.bind(null, 'first')} className="mt-4">
            <ConfirmSubmit className="btn btn-primary w-full" pendingLabel={t('building')}>{t('build')}</ConfirmSubmit>
          </form>
        </section>
        {libraryLink}
      </div>
    );
  }

  const { meso, days } = block;
  const [library, sessions, readiness] = await Promise.all([loadLibrary(), loadSessions(sb, meso.id), loadReadiness(sb, isoMinusDays(today, 7))]);
  const name = new Map(library.map((e) => [e.slug, e]));
  const wc = weekContext(mesoInfo(meso), profile.experience ?? 'none', today);
  const view = weekView(meso, days, sessions, today);
  const todayReady = readiness.find((r) => r.date === today);
  const low = todayIsLow(todayReady);
  const hold = holdRampFor(readiness, today);
  const early = view.over ? null : await earlyDeloadCheck(sb, meso, days, today, wc);
  const phase = wc.deload ? 'deload' : wc.technique ? 'technique' : wc.week >= meso.deloadWeek - 1 ? 'peak' : 'build';
  const settingsChanged = profile.days_per_week !== meso.daysPerWeek || profile.session_minutes !== meso.sessionMinutes;
  const dayName = (k: DayKind) => t(`days.${k}`);
  const planned = plannedDates(meso.startDate, Math.max(1, Math.min(view.weekNow, meso.weeks)), meso.trainingDays, days.length);
  const next = view.state.next;
  const nextDay = next ? days[next.dayIdx]! : null;
  const preview = nextDay?.exercises.map((x) => ({ ...x, n: setsFor(x.sets, wc, { holdRamp: hold, lowReadiness: low }) })) ?? [];
  const recent = sessions.filter((s) => s.status !== 'active').slice(-6).reverse();

  return (
    <div className="space-y-4 pt-2">
      <header className="rise">
        <h1 className="text-3xl font-extrabold">{t('title')}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{t('block', { n: fmtNum(meso.blockNo, d) })}</span>
          <span className="num">{t('weekOf', { week: fmtNum(Math.min(view.weekNow, meso.weeks), d), weeks: fmtNum(meso.weeks, d) })}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${phase === 'deload' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent-text'}`}>{t(`phase.${phase}`)}</span>
        </div>
        {/* Block timeline: one segment per week, the deload last. */}
        <ol className="mt-3 flex gap-1" aria-label={t('weekOf', { week: fmtNum(view.weekNow, d), weeks: fmtNum(meso.weeks, d) })}>
          {Array.from({ length: meso.weeks }, (_, i) => i + 1).map((w) => (
            <li key={w} className={`h-1.5 flex-1 rounded-full ${w < view.weekNow ? 'bg-accent' : w === view.weekNow ? 'bg-accent/60' : 'bg-surface-2'} ${w >= meso.deloadWeek ? 'outline outline-1 outline-ok/40' : ''}`} />
          ))}
        </ol>
        {!view.over && <p className="mt-2 text-sm text-muted">{t(`phaseHint.${phase}`)}</p>}
      </header>

      {active && (
        <section className="card border-accent rise">
          <h2 className="card-title">{t('resumeTitle')}</h2>
          <p className="mt-1 text-muted">{((active as { kinds?: DayKind[] }).kinds ?? []).map(dayName).join(' + ')}</p>
          <Link href="/gym" className="btn btn-primary mt-4 w-full">{t('resume')}</Link>
        </section>
      )}

      {view.over ? (
        <section className="card rise">
          <h2 className="card-title">{t('blockOverTitle')}</h2>
          <p className="mt-2 text-muted">{t('blockOver')}</p>
          <form action={createBlock.bind(null, 'completed')} className="mt-4">
            <ConfirmSubmit className="btn btn-primary w-full" pendingLabel={t('building')}>{t('nextBlock')}</ConfirmSubmit>
          </form>
        </section>
      ) : (
        <>
          {early && (
            <section className="card" aria-labelledby="deload-h">
              <h2 id="deload-h" className="card-title">{t('earlyDeloadTitle')}</h2>
              <p className="mt-2 text-muted">{t(`earlyDeload.${early}`)}</p>
              <form action={acceptEarlyDeload.bind(null, early)} className="mt-3"><ConfirmSubmit className="btn btn-secondary w-full">{t('earlyDeloadAccept')}</ConfirmSubmit></form>
            </section>
          )}

          {!active && next && nextDay && (
            <section className="card rise" aria-labelledby="next-h">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="next-h" className="card-title">{view.state.dueToday || view.state.late ? t('todayTitle') : t('nextTitle')}</h2>
                <span className="text-sm text-muted">{t('plannedFor', { date: fmtDate(next.planned, d, { weekday: 'long', day: 'numeric', month: 'long' }) })}</span>
              </div>
              <p className="mt-1 text-2xl font-extrabold">{dayName(nextDay.kind)}</p>
              <p className="text-sm text-muted num">
                {t('exercisesCount', { n: fmtNum(preview.length, d) })} · {t('estMinutes', { n: fmtNum(Math.round(sessionMinutes(preview.map((x) => ({ role: x.role, sets: x.n })))), d) })}
              </p>
              <ul className="mt-3 divide-y divide-line border-y border-line text-[0.9375rem]">
                {preview.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{name.get(x.slug)?.nameFa ?? x.slug}</span>
                    <span className="num shrink-0 text-muted" dir="ltr">{x.n} × {x.reps[0]}–{x.reps[1]}{name.get(x.slug)?.timed ? 's' : ''}</span>
                  </li>
                ))}
              </ul>

              {view.state.late ? (
                <div className="mt-4">
                  <p className="note note-warn">{t('late', { day: dayName(nextDay.kind), date: fmtDate(next.planned, d, { weekday: 'long' }) })}</p>
                  <div className="mt-3 grid gap-2">
                    <form action={startWorkout}>
                      <LocalDate fallback={today} />
                      <input type="hidden" name="day" value={next.dayIdx} />
                      {low && <input type="hidden" name="dropLastSet" value="1" />}
                      <ConfirmSubmit className="btn btn-primary w-full">{t('shift')}</ConfirmSubmit>
                      <p className="field-hint text-center">{t('shiftHint')}</p>
                    </form>
                    {view.options.includes('merge') && (
                      <form action={startWorkout}>
                        <LocalDate fallback={today} />
                        <input type="hidden" name="day" value={next.dayIdx} />
                        <input type="hidden" name="merge" value="1" />
                        {low && <input type="hidden" name="dropLastSet" value="1" />}
                        <ConfirmSubmit className="btn btn-secondary w-full">{t('merge')}</ConfirmSubmit>
                        <p className="field-hint text-center">{t('mergeHint')}</p>
                      </form>
                    )}
                    <form action={skipDay.bind(null, next.dayIdx)}>
                      <ConfirmSubmit className="btn btn-ghost w-full">{t('skip')}</ConfirmSubmit>
                      <p className="field-hint mt-0 text-center">{t('skipHint')}</p>
                    </form>
                  </div>
                </div>
              ) : (
                <form action={startWorkout} className="mt-4">
                  <LocalDate fallback={today} />
                  <input type="hidden" name="day" value={next.dayIdx} />
                  {low && (
                    <label className="mb-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" name="dropLastSet" value="1" defaultChecked className="h-5 w-5" />{t('dropLastSet')}
                    </label>
                  )}
                  {!view.state.dueToday && <p className="mb-3 text-sm text-muted">{t('restDay')}</p>}
                  <ConfirmSubmit className={`btn w-full ${view.state.dueToday ? 'btn-primary' : 'btn-secondary'}`}>
                    {view.state.dueToday ? t('start') : t('startAnyway')}
                  </ConfirmSubmit>
                </form>
              )}
            </section>
          )}
          {!active && !next && <p className="card text-muted">{t('weekDone')}</p>}

          <ReadinessCard today={today} low={low} digits={d}
            entry={todayReady ? { sleepHours: todayReady.sleepHours, energy: todayReady.energy, soreness: todayReady.soreness } : null} />

          <section className="card" aria-labelledby="week-h">
            <h2 id="week-h" className="card-title">{t('thisWeek')}</h2>
            <ul className="mt-3 space-y-2">
              {days.map((day) => {
                const s = sessions.find((x) => x.week === view.weekNow && (x.dayIdx === day.idx || x.mergedDayIdx === day.idx));
                const status = s?.status === 'active' ? 'active' : s?.status === 'done' ? 'done' : s?.status === 'skipped' ? 'skipped' : next?.dayIdx === day.idx ? 'next' : 'upcoming';
                return (
                  <li key={day.id} className="flex items-center gap-3">
                    <span className={`grid h-10 w-12 shrink-0 place-items-center rounded-xl text-xs font-bold ${
                      status === 'done' ? 'bg-ok-soft text-ok' : status === 'next' || status === 'active' ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted'}`}>
                      {weekdays[weekday(planned[day.idx]!)]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className={`block ${status === 'skipped' ? 'text-muted line-through' : ''}`}>{dayName(day.kind)}</b>
                      <span className="text-xs text-muted">{fmtDate(planned[day.idx]!, d)}</span>
                    </span>
                    {s && s.status !== 'active' ? (
                      <Link href={`/workout/history/${s.id}`} className="text-sm text-accent-text">{t(`status.${status}`)}</Link>
                    ) : <span className="text-sm text-muted">{t(`status.${status}`)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {meso.missing.length > 0 && (
        <p role="note" className="note note-info">{t('missing', { list: meso.missing.map((p) => t(`pattern.${p}`)).join('، ') })}</p>
      )}
      {settingsChanged && !view.over && (
        <section className="card">
          <p className="text-muted">{t('settingsChanged')}</p>
          <form action={createBlock.bind(null, 'rebuilt')} className="mt-3">
            <ConfirmSubmit className="btn btn-secondary w-full" confirm={t('rebuildConfirm')} pendingLabel={t('building')}>{t('rebuild')}</ConfirmSubmit>
          </form>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card" aria-labelledby="hist-h">
          <h2 id="hist-h" className="card-title">{t('history')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {recent.map((s) => (
              <li key={s.id}>
                <Link href={`/workout/history/${s.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <b className="block">{(s.plan?.kinds ?? [days[s.dayIdx]?.kind]).filter(Boolean).map((k) => dayName(k as DayKind)).join(' + ')}</b>
                    <span className="text-xs text-muted">{fmtDate(s.date, d, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  </span>
                  <span className="num text-sm text-muted">
                    {s.status === 'skipped' ? t('status.skipped') : s.summary ? t('historyMeta', { sets: fmtNum(s.summary.workingSets, d), minutes: fmtNum(s.summary.minutes, d) }) : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!view.over && !settingsChanged && (
        <form action={createBlock.bind(null, 'rebuilt')} className="text-center">
          <ConfirmSubmit className="btn btn-ghost text-sm" confirm={t('rebuildConfirm')} pendingLabel={t('building')}>{t('rebuild')}</ConfirmSubmit>
        </form>
      )}
      {libraryLink}
    </div>
  );
}
