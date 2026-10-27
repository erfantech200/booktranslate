import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MEASURES, measurementStatus, photoStatus } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { IconCamera } from '@/components/icons';
import { LineChart } from '@/components/progress/LineChart';
import { MeasureForm } from '@/components/progress/MeasureForm';
import { ProgressHeader } from '@/components/progress/ProgressNav';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { fmtDate, fmtNum } from '@/lib/format';
import { requireProfile } from '@/lib/profile';
import { loadMeasurements, loadPhotoIndex, signPhotos } from '@/lib/progress';
import { deleteMeasurements, deletePhoto } from '@/lib/progressActions';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';
const ANGLES = ['front', 'side', 'back'] as const;

export default async function BodyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress.body');
  const tp = await getTranslations('photos');
  const tdue = await getTranslations('progress.due');
  const tc = await getTranslations('common');
  const today = await localToday();
  const d = profile.digits;
  const [measurements, photos] = await Promise.all([loadMeasurements(sb), loadPhotoIndex(sb)]);

  const last = Object.fromEntries(MEASURES.map((k) => [k, measurements.filter((m) => m[k] != null).at(-1)?.[k] ?? null]));
  const byDate = Object.fromEntries(measurements.map((m) => [m.date, { waist: m.waist, chest: m.chest, arm: m.arm, thigh: m.thigh }]));
  const ms = measurementStatus(measurements, today);
  const dates = [...new Set(photos.map((p) => p.date))];
  const ps = photoStatus(dates, today);
  const latest = photos.filter((p) => p.date === dates[0]);
  const thumbs = photos.filter((p) => p.angle === 'front' || !photos.some((q) => q.date === p.date && q.angle === 'front'))
    .filter((p, i, a) => a.findIndex((q) => q.date === p.date) === i);
  const urls = await signPhotos(sb, [...latest, ...thumbs.filter((p) => p.date !== dates[0])]);
  const first = measurements[0];

  return (
    <div className="space-y-4">
      <ProgressHeader active="body" />

      <section className="card scroll-mt-4" aria-labelledby="m-h" id="measure">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="m-h" className="card-title">{t('measureTitle')}</h2>
          {!ms.due && <span className="text-sm text-muted">{tdue('measureNext', { date: fmtDate(ms.next, d) })}</span>}
        </div>
        <p className="field-hint mb-4">{t('measureHint')}</p>
        <MeasureForm last={last} byDate={byDate} digits={d} />
      </section>

      <section className="card" aria-labelledby="mc-h">
        <h2 id="mc-h" className="card-title">{t('chartsTitle')}</h2>
        {measurements.length === 0 ? <p className="mt-2 text-muted">{t('noMeasures')}</p>
          : measurements.length === 1 ? <p className="mt-2 text-muted">{t('oneMeasure')}</p> : (
            <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {MEASURES.map((k) => {
                const pts = measurements.filter((m) => m[k] != null).map((m) => ({ date: m.date, value: m[k]! }));
                if (pts.length < 2) return null;
                const diff = pts.at(-1)!.value - pts[0]!.value;
                return (
                  <figure key={k} className="m-0">
                    <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-bold">{t(k)}</span>
                      <span className="text-xs text-muted"><span className="num" dir="ltr">{diff >= 0 ? '+' : '−'}{fmtNum(Math.abs(diff), d, { maximumFractionDigits: 1 })}</span> {tc('cm')}</span>
                    </figcaption>
                    <LineChart points={pts} domain={{ from: first!.date, to: measurements.at(-1)!.date }} unit={tc('cm')} digits={d} label={t(k)} height={130} />
                  </figure>
                );
              })}
            </div>
          )}
        {measurements.length > 0 && (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer py-1 text-sm font-medium text-accent-text">{t('historyTitle')}</summary>
            <div className="-mx-1 overflow-x-auto">
              <table className="mt-2 w-full min-w-[22rem] text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="pb-2 text-start font-medium">{t('date')}</th>
                    {MEASURES.map((k) => <th key={k} className="pb-2 text-end font-medium">{t(k).split(' (')[0]}</th>)}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...measurements].reverse().map((m) => (
                    <tr key={m.id}>
                      <td className="py-2">{fmtDate(m.date, d, { day: 'numeric', month: 'short' })}</td>
                      {MEASURES.map((k) => <td key={k} className="num py-2 text-end">{m[k] != null ? fmtNum(m[k]!, d) : '–'}</td>)}
                      <td className="py-1 text-end">
                        <form action={deleteMeasurements.bind(null, m.id)}><button className="btn btn-ghost min-h-9 px-2 text-xs">{tc('delete')}</button></form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="card" aria-labelledby="p-h" id="photos">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="p-h" className="card-title">{t('photosTitle')}</h2>
          {ps.last && !ps.due && <span className="text-sm text-muted">{tdue('photosNext', { date: fmtDate(ps.next, d) })}</span>}
        </div>
        <p className="field-hint">{t('photosHint')}</p>
        {latest.length === 0 ? <p className="mt-3 text-muted">{t('photosEmpty')}</p> : (
          <>
            <p className="mt-4 text-sm font-medium">{fmtDate(dates[0]!, d, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {ANGLES.map((a) => {
                const p = latest.find((x) => x.angle === a);
                return (
                  <figure key={a} className="m-0">
                    {p && urls.get(p.id)
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      ? <img src={urls.get(p.id)} alt={`${tp(a)}، ${fmtDate(p.date, d)}`} className="aspect-[3/4] w-full rounded-xl bg-surface-2 object-cover" />
                      : <div className="aspect-[3/4] w-full rounded-xl border border-dashed border-line bg-surface-2" />}
                    <figcaption className="mt-1 flex items-center justify-between text-xs text-muted">
                      {tp(a)}
                      {p && (
                        <form action={deletePhoto.bind(null, p.id)}>
                          <ConfirmSubmit confirm={t('deletePhoto')} className="btn btn-ghost min-h-8 px-1.5 text-xs">{tc('delete')}</ConfirmSubmit>
                        </form>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <Link href="/progress/photos/new" className="btn btn-primary flex-1"><IconCamera className="h-5 w-5" />{t('takePhotos')}</Link>
          {dates.length >= 2 && <Link href="/progress/photos/compare" className="btn btn-secondary flex-1">{t('compare')}</Link>}
        </div>
        {dates.length > 1 && (
          <>
            <h3 className="mt-5 text-sm font-bold">{t('allDates')}</h3>
            <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
              {thumbs.map((p) => (
                <li key={p.date} className="w-20 shrink-0">
                  <Link href={`/progress/photos/compare?a=${p.date}&b=${dates[0]}`} className="block">
                    {urls.get(p.id)
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      ? <img src={urls.get(p.id)} alt="" className="aspect-[3/4] w-full rounded-lg bg-surface-2 object-cover" />
                      : <div className="aspect-[3/4] w-full rounded-lg bg-surface-2" />}
                    <span className="mt-1 block text-center text-xs text-muted">{fmtDate(p.date, d, { day: 'numeric', month: 'short' })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
