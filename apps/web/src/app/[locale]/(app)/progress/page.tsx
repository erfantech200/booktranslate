import { getTranslations, setRequestLocale } from 'next-intl/server';
import { addDays } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { WeightChart, type Pt } from '@/components/WeightChart';
import { fmtDate, fmtNum } from '@/lib/format';
import { loadPhotos } from '@/lib/photos';
import { planSummary } from '@/lib/plan';
import { requireProfile } from '@/lib/profile';
import { deleteWeight } from '@/lib/weightActions';
import { loadWeighIns } from '@/lib/weights';

export const dynamic = 'force-dynamic';
const RANGES = { '4w': 28, '12w': 84, all: 0 } as const;
type Range = keyof typeof RANGES;

export default async function ProgressPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const range: Range = ((await searchParams).range as Range) in RANGES ? ((await searchParams).range as Range) : '12w';
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress');
  const tc = await getTranslations('common');
  const [weighIns, photos] = await Promise.all([loadWeighIns(sb), loadPhotos(sb)]);
  const s = planSummary(profile, weighIns);
  const d = profile.digits;

  const today = new Date().toISOString().slice(0, 10);
  const horizon = s.plan.at(-1)!.date;
  const domain = range === 'all'
    ? { from: addDays(s.startDate, -3), to: horizon }
    // Never earlier than a few days before the start (so the first weigh-in isn't on the edge).
    : { from: [addDays(today, -RANGES[range]), addDays(s.startDate, -3)].sort()[1]!, to: addDays(today, Math.round(RANGES[range] / 6)) };
  const inside = (q: Pt, pad = 0) => q.date >= addDays(domain.from, -pad) && q.date <= addDays(domain.to, pad);
  const raw = weighIns.map((w) => ({ date: w.date, kg: w.weightKg }));
  const newestFirst = [...weighIns].reverse();
  const latest = newestFirst.slice(0, 10);
  const older = newestFirst.slice(10);
  const projection = s.projection && s.current != null
    ? { from: { date: s.trend.at(-1)!.date, kg: s.current }, to: { date: s.projection.horizonDate, kg: s.projection.atHorizonKg } }
    : null;

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-extrabold">{t('title')}</h1>

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

      <section className="card" aria-labelledby="h-h">
        <h2 id="h-h" className="card-title">{t('history')}</h2>
        {weighIns.length === 0 ? <p className="mt-2 text-muted">{t('noData')}</p> : (
          <>
          <table className="mt-3 w-full text-sm">
            <thead className="text-muted">
              <tr><th className="pb-2 text-start font-medium">{t('date')}</th><th className="pb-2 text-end font-medium">{t('weightCol')}</th>
                <th className="pb-2 text-end font-medium">{t('trendCol')}</th><th className="w-12" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {latest.map((w) => (
                <tr key={w.id}>
                  <td className="py-2">{fmtDate(w.date, d, { weekday: 'short', day: 'numeric', month: 'long' })}</td>
                  <td className="py-2 text-end num font-bold">{fmtNum(w.weightKg, d)}</td>
                  <td className="py-2 text-end num text-muted">{fmtNum(s.trend.find((q) => q.date === w.date)!.kg, d)}</td>
                  <td className="py-1 text-end">
                    <form action={deleteWeight.bind(null, w.id)}><button className="btn btn-ghost min-h-9 px-2 text-xs">{tc('delete')}</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {older.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-2 text-sm font-medium text-accent-text">{t('showAll')}</summary>
              <table className="mt-3 w-full text-sm">
            <thead className="text-muted">
              <tr><th className="pb-2 text-start font-medium">{t('date')}</th><th className="pb-2 text-end font-medium">{t('weightCol')}</th>
                <th className="pb-2 text-end font-medium">{t('trendCol')}</th><th className="w-12" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {older.map((w) => (
                <tr key={w.id}>
                  <td className="py-2">{fmtDate(w.date, d, { weekday: 'short', day: 'numeric', month: 'long' })}</td>
                  <td className="py-2 text-end num font-bold">{fmtNum(w.weightKg, d)}</td>
                  <td className="py-2 text-end num text-muted">{fmtNum(s.trend.find((q) => q.date === w.date)!.kg, d)}</td>
                  <td className="py-1 text-end">
                    <form action={deleteWeight.bind(null, w.id)}><button className="btn btn-ghost min-h-9 px-2 text-xs">{tc('delete')}</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </details>
          )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="p-h">
        <h2 id="p-h" className="card-title">{t('photos')}</h2>
        {photos.length > 0 && (
          <div className="mt-3 grid max-w-md grid-cols-3 gap-2">
            {photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img key={p.id} src={p.url} alt="" className="aspect-[3/4] w-full rounded-xl object-cover" />
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-muted">{t('photosLater')} {t('measurementsLater')}</p>
        <Link href="/onboarding/photos" className="btn btn-secondary mt-3">{t('addPhotos')}</Link>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="text-lg font-bold"><span className="num">{value}</span>{unit && <span className="block text-xs font-normal text-muted">{unit}</span>}</dd>
    </div>
  );
}
