import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  addDays, COACH, gainQuality, measurementStatus, nutritionAdherence, photoStatus, streak, weekOfDate, workoutAdherence,
  type GainQuality,
} from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { IconCamera, IconRuler } from '@/components/icons';
import { ProgressHeader } from '@/components/progress/ProgressNav';
import { Status, type Tone } from '@/components/progress/Status';
import { WeightChart, type Pt } from '@/components/WeightChart';
import { fmtDate, fmtNum, type Digits } from '@/lib/format';
import { planSummary } from '@/lib/plan';
import { requireProfile } from '@/lib/profile';
import { loadFoodDays, loadMainLifts, loadMeasurements, loadPhotoIndex, loadTargetsByDate, loadWorkSets } from '@/lib/progress';
import { localToday } from '@/lib/today';
import { deleteWeight } from '@/lib/weightActions';
import { loadWeighIns, type WeighInRow } from '@/lib/weights';

export const dynamic = 'force-dynamic';
const RANGES = { '4w': 28, '12w': 84, all: 0 } as const;
type Range = keyof typeof RANGES;
const P = COACH.progress;

export default async function ProgressPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const range: Range = (sp.range as Range) in RANGES ? (sp.range as Range) : '12w';
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress');
  const tc = await getTranslations('common');
  const today = await localToday();
  const start = profile.start_date!;
  const [weighIns, measurements, work, mainLifts, photos, foodDays, targetFor] = await Promise.all([
    loadWeighIns(sb), loadMeasurements(sb), loadWorkSets(sb), loadMainLifts(sb), loadPhotoIndex(sb), loadFoodDays(sb, start), loadTargetsByDate(sb),
  ]);
  const s = planSummary(profile, weighIns, today);
  const d = profile.digits;

  // ─── Weight chart ─────────────────────────────────────────────────────────────────────
  const horizon = s.plan.at(-1)!.date;
  const domain = range === 'all'
    ? { from: addDays(s.startDate, -3), to: horizon }
    // Never earlier than a few days before the start (so the first weigh-in isn't on the edge).
    : { from: [addDays(today, -RANGES[range]), addDays(s.startDate, -3)].sort()[1]!, to: addDays(today, Math.round(RANGES[range] / 6)) };
  const inside = (q: Pt, pad = 0) => q.date >= addDays(domain.from, -pad) && q.date <= addDays(domain.to, pad);
  const raw = weighIns.map((w) => ({ date: w.date, kg: w.weightKg }));
  const newestFirst = [...weighIns].reverse();
  const projection = s.projection && s.current != null
    ? { from: { date: s.trend.at(-1)!.date, kg: s.current }, to: { date: s.projection.horizonDate, kg: s.projection.atHorizonKg } }
    : null;

  // ─── Gain quality, adherence, streaks, reminders ──────────────────────────────────────
  const quality = gainQuality({ weighIns, measurements, sets: work.sets, mainLifts, today });
  const thisWeek = weekOfDate(today);
  const weeks = Array.from({ length: P.adherenceWeeks }, (_, i) => addDays(thisWeek, -7 * (P.adherenceWeeks - i)))
    .filter((w) => addDays(w, 6) >= start);
  const wk = workoutAdherence(work.sessions.map((x) => x.date), weeks, profile.days_per_week ?? 3);
  const since = [addDays(today, -P.adherenceWeeks * 7), start].sort()[1]!;
  const windowDays = Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86_400_000));
  const food = nutritionAdherence(foodDays.filter((x) => x.date >= since && x.date < today), targetFor);
  const streaks = {
    weigh: streak(weighIns.map((w) => w.date), today),
    food: streak(foodDays.filter((x) => x.kcal > 0).map((x) => x.date), today),
  };
  const ms = measurementStatus(measurements, today);
  const ps = photoStatus([...new Set(photos.map((p) => p.date))], today);

  return (
    <div className="space-y-4">
      <ProgressHeader active="overview" />

      {(ms.due || ps.due) && (
        <section className="card space-y-3" aria-labelledby="due-h">
          <h2 id="due-h" className="card-title">{t('due.title')}</h2>
          {ms.due && (
            <Reminder Icon={IconRuler} text={t('due.measure')} href="/progress/body#measure" cta={t('due.measureCta')} />
          )}
          {ps.due && (
            <Reminder Icon={IconCamera} text={ps.overdue && ps.last ? t('due.photosOverdue') : t('due.photos')} href="/progress/photos/new" cta={t('due.photoCta')} />
          )}
        </section>
      )}

      <QualityCard q={quality} digits={d} />

      <section className="card" aria-labelledby="w-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="w-h" className="card-title">{t('weight')}</h2>
          <nav className="flex rounded-xl bg-surface-2 p-1 text-sm" aria-label={t('weight')}>
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link key={r} href={`/progress?range=${r}`} aria-current={r === range ? 'true' : undefined}
                className={`rounded-lg px-3 py-1.5 ${r === range ? 'bg-surface font-bold text-fg shadow' : 'text-muted hover:text-fg'}`}>
                {t(r === '4w' ? 'range4w' : r === '12w' ? 'range12w' : 'rangeAll')}
              </Link>
            ))}
          </nav>
        </div>
        {weighIns.length === 0 ? <p className="text-muted">{t('noData')}</p> : (
          <WeightChart raw={raw.filter((q) => inside(q))} trend={s.trend.filter((q) => inside(q, 7))}
            plan={s.plan.filter((q) => inside(q, 7))} projection={projection} domain={domain}
            target={{ date: horizon, kg: s.target12m }} digits={d}
            labels={{ raw: t('legendRaw'), trend: t('legendTrend'), plan: t('legendPlan'), projection: t('legendProjection'), kg: tc('kg') }} />
        )}
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
          <Stat label={t('start')} value={`${fmtNum(s.startKg, d)}`} />
          <Stat label={t('current')} value={s.current != null ? fmtNum(s.current, d) : '–'} />
          <Stat label={t('rate')} value={s.projection ? fmtNum(s.projection.kgPerWeek, d, { maximumFractionDigits: 2 }) : '–'} unit={s.projection ? t('perWeek') : undefined} />
          <Stat label={t('target')} value={fmtNum(s.targetKgPerWeek, d, { maximumFractionDigits: 2 })} unit={t('perWeek')} />
        </dl>
        <p className="mt-3 text-sm text-muted">
          {s.projection
            ? <>{t('projection')}: <b className="num text-fg">{t('projectionOf', { kg: fmtNum(s.projection.atHorizonKg, d), target: fmtNum(s.target12m, d) })}</b></>
            : t('projectionPending')}
        </p>
      </section>

      <section className="card" aria-labelledby="ad-h">
        <h2 id="ad-h" className="card-title">{t('adherence.title')}</h2>
        <div className="mt-4 space-y-4">
          {wk.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{t('adherence.workouts')}</span>
                <b className="num">{t('adherence.ofPlanned', { done: fmtNum(wk.reduce((a, w) => a + Math.min(w.done, w.planned), 0), d), planned: fmtNum(wk.reduce((a, w) => a + w.planned, 0), d) })}</b>
              </div>
              <ol className="mt-2 grid gap-3" style={{ gridTemplateColumns: `repeat(${wk.length}, minmax(0, 1fr))` }}>
                {wk.map((w) => (
                  <li key={w.week} title={t('adherence.weekLabel', { date: fmtDate(w.week, d) })} aria-label={`${t('adherence.weekLabel', { date: fmtDate(w.week, d) })}: ${t('adherence.ofPlanned', { done: fmtNum(w.done, d), planned: fmtNum(w.planned, d) })}`}
                    className="flex gap-0.5">
                    {Array.from({ length: w.planned }, (_, i) => (
                      <span key={i} className={`h-2.5 flex-1 rounded-sm ${i < w.done ? 'bg-accent' : 'bg-surface-2'}`} />
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {food.logged === 0 ? <p className="text-sm text-muted">{t('adherence.noFood')}</p> : (
            <>
              <Meter label={t('adherence.protein')} value={food.proteinHit} of={food.logged} text={t('adherence.daysOf', { n: fmtNum(food.proteinHit, d), of: fmtNum(food.logged, d) })} />
              <Meter label={t('adherence.kcal')} value={food.kcalHit} of={food.logged} text={t('adherence.daysOf', { n: fmtNum(food.kcalHit, d), of: fmtNum(food.logged, d) })} />
              <p className="field-hint num">{t('adherence.loggedNote', { n: fmtNum(food.logged, d), of: fmtNum(windowDays, d) })}</p>
            </>
          )}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-bold">{t('adherence.streaks')}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <Stat label={t('adherence.streakWeigh')} value={fmtNum(streaks.weigh, d)} unit={t('adherence.dayUnit')} />
            <Stat label={t('adherence.streakFood')} value={fmtNum(streaks.food, d)} unit={t('adherence.dayUnit')} />
          </dl>
        </div>
      </section>

      <section className="card" aria-labelledby="h-h">
        <h2 id="h-h" className="card-title">{t('history')}</h2>
        {weighIns.length === 0 ? <p className="mt-2 text-muted">{t('noData')}</p> : (
          <>
            <WeighTable rows={newestFirst.slice(0, 10)} trend={s.trend} digits={d} t={t} del={tc('delete')} />
            {newestFirst.length > 10 && (
              <details className="mt-2">
                <summary className="cursor-pointer py-2 text-sm font-medium text-accent-text">{t('showAll')}</summary>
                <WeighTable rows={newestFirst.slice(10)} trend={s.trend} digits={d} t={t} del={tc('delete')} />
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const TONE: Record<GainQuality['level'], Tone> = { good: 'good', ok: 'neutral', watch: 'warn', insufficient: 'muted' };

async function QualityCard({ q, digits: d }: { q: GainQuality; digits: Digits }) {
  const t = await getTranslations('progress.quality');
  const tc = await getTranslations('common');
  const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n), d, { maximumFractionDigits: digits })}`;
  return (
    <section className="card" aria-labelledby="q-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="q-h" className="card-title">{t('title')}</h2>
        <Status tone={TONE[q.level]}>{t(q.level)}</Status>
      </div>
      <p className="mt-1 text-xs text-muted">{t('window', { from: fmtDate(q.from, d), to: fmtDate(q.to, d) })}</p>
      <p className="mt-3 leading-7">{q.level === 'insufficient' ? t('insufficientText', { kg: fmtNum(P.qualityMinWeightChangeKg, d) }) : t(`${q.level}Text`)}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label={t('weight')} value={q.weightChangeKg != null ? signed(q.weightChangeKg, 2) : '–'} unit={q.weightChangeKg != null ? tc('kg') : undefined} />
        <Stat label={t('waist')} value={q.waistChangeCm != null ? signed(q.waistChangeCm) : '–'} unit={q.waistChangeCm != null ? tc('cm') : undefined} />
        <Stat label={t('perKg')} value={q.waistPerKg != null ? signed(q.waistPerKg, 2) : '–'} unit={q.waistPerKg != null ? t('cmPerKg') : undefined} />
        <Stat label={t('strength')} value={q.strengthChangePct != null ? `${signed(q.strengthChangePct)}٪` : '–'} />
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer py-1 text-sm font-medium text-accent-text">{t('how')}</summary>
        <p className="mt-2 text-sm leading-7 text-muted">{t('howText', { good: fmtNum(P.waistPerKgGood, d), watch: fmtNum(P.waistPerKgWatch, d) })}</p>
      </details>
    </section>
  );
}

function Reminder({ Icon, text, href, cta }: { Icon: typeof IconRuler; text: string; href: string; cta: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text"><Icon className="h-5 w-5" /></span>
      <p className="flex-1 text-sm leading-6">{text}</p>
      <Link href={href} className="btn btn-secondary min-h-10 shrink-0 px-3 text-sm">{cta}</Link>
    </div>
  );
}

function Meter({ label, value, of, text }: { label: string; value: number; of: number; text: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span>{label}</span><b className="num">{text}</b></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={value}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${of ? (value / of) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function WeighTable({ rows, trend, digits: d, t, del }: {
  rows: WeighInRow[]; trend: { date: string; kg: number }[]; digits: Digits; t: (k: string) => string; del: string;
}) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-muted">
        <tr><th className="pb-2 text-start font-medium">{t('date')}</th><th className="pb-2 text-end font-medium">{t('weightCol')}</th>
          <th className="pb-2 text-end font-medium">{t('trendCol')}</th><th className="w-12" /></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((w) => (
          <tr key={w.id}>
            <td className="py-2">{fmtDate(w.date, d, { weekday: 'short', day: 'numeric', month: 'long' })}</td>
            <td className="py-2 text-end num font-bold">{fmtNum(w.weightKg, d)}</td>
            <td className="py-2 text-end num text-muted">{fmtNum(trend.find((q) => q.date === w.date)!.kg, d)}</td>
            <td className="py-1 text-end">
              <form action={deleteWeight.bind(null, w.id)}><button className="btn btn-ghost min-h-9 px-2 text-xs">{del}</button></form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="text-lg font-bold"><span className="num" dir="ltr">{value}</span>{unit && <span className="block text-xs font-normal text-muted">{unit}</span>}</dd>
    </div>
  );
}
