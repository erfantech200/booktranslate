import { getTranslations, setRequestLocale } from 'next-intl/server';
import { timeline, type TimelineEvent } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { IconCamera, IconFlag, IconRuler, IconScale, IconTrophy, IconWorkout } from '@/components/icons';
import { ProgressHeader } from '@/components/progress/ProgressNav';
import { fmtDate, fmtNum } from '@/lib/format';
import { librarySlugMap } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { firstTimes, loadBlocks, loadMeasurements, loadPhotoIndex, loadPRs, loadWorkSets, signPhotos } from '@/lib/progress';
import { loadWeighIns } from '@/lib/weights';

export const dynamic = 'force-dynamic';

const ICON: Record<TimelineEvent['kind'], typeof IconFlag> = {
  start: IconFlag, block: IconWorkout, prs: IconTrophy, photos: IconCamera, weight: IconScale, workouts: IconWorkout, measure: IconRuler,
};

/** The year on one scrolling line: start, blocks, PRs, weight and workout milestones, measurements, photos. */
export default async function JourneyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress.journey');
  const ts = await getTranslations('progress.strength');
  const d = profile.digits;
  const [weighIns, measurements, { sets, sessions }, prs, blocks, photos, bySlug] = await Promise.all([
    loadWeighIns(sb), loadMeasurements(sb), loadWorkSets(sb), loadPRs(sb), loadBlocks(sb), loadPhotoIndex(sb), librarySlugMap(),
  ]);
  const first = firstTimes(sets);
  const events = timeline({
    startDate: profile.start_date!, startWeightKg: profile.start_weight_kg!, weighIns, blocks, prs: prs.filter((p) => first.get(p.slug) !== p.date),
    photos: photos.map((p) => ({ date: p.date, angle: p.angle })), workouts: sessions.map((s) => s.date), measurements,
  });
  // A front-view thumbnail for each photo day.
  const thumbs = new Map(photos.filter((p) => p.angle === 'front').map((p) => [p.date, p]));
  const urls = await signPhotos(sb, [...thumbs.values()]);

  const months: { key: string; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const key = fmtDate(e.date, d, { month: 'long', year: 'numeric' });
    if (months.at(-1)?.key !== key) months.push({ key, items: [] });
    months.at(-1)!.items.push(e);
  }

  const text = (e: TimelineEvent) => {
    switch (e.kind) {
      case 'start': return t('start', { kg: fmtNum(e.weightKg, d) });
      case 'block': return t('block', { n: fmtNum(e.blockNo, d) });
      case 'prs': return t('prs', { n: fmtNum(e.items.length, d) });
      case 'photos': return t('photos');
      case 'weight': return t('weight', { gained: fmtNum(e.gained, d), kg: fmtNum(e.kg, d) });
      case 'workouts': return e.count === 1 ? t('workoutsFirst') : t('workouts', { n: fmtNum(e.count, d) });
      case 'measure': return e.waist != null ? t('measure', { waist: fmtNum(e.waist, d) }) : t('measureNoWaist');
    }
  };
  const major = (e: TimelineEvent) => e.kind === 'start' || e.kind === 'block' || e.kind === 'weight' || e.kind === 'workouts';

  return (
    <div className="space-y-4">
      <ProgressHeader active="journey" />
      <p className="text-sm text-muted">{t('intro')}</p>
      {months.map((m) => (
        <section key={m.key} className="card" aria-label={m.key}>
          <h2 className="card-title">{m.key}</h2>
          <ol className="relative mt-3 space-y-4 before:absolute before:inset-y-1 before:start-[1.1rem] before:w-px before:bg-line">
            {m.items.map((e, i) => {
              const Icon = ICON[e.kind];
              const thumb = e.kind === 'photos' ? thumbs.get(e.date) : undefined;
              return (
                <li key={`${e.kind}-${e.date}-${i}`} className="relative flex items-start gap-3">
                  <span className={`relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border ${major(e) ? 'border-accent bg-accent-soft text-accent-text' : 'border-line bg-surface-2 text-muted'}`}>
                    <Icon className="h-[1.1rem] w-[1.1rem]" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className={major(e) ? 'font-bold' : ''}>{text(e)}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(e.date, d, { weekday: 'short', day: 'numeric', month: 'long' })}
                    </p>
                    {e.kind === 'prs' && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm font-medium text-accent-text">{t('showRecords')}</summary>
                        <ul className="mt-1.5 space-y-0.5 text-sm">
                          {e.items.map((x) => (
                            <li key={x.slug} className="flex justify-between gap-3">
                              <span className="truncate">{bySlug.get(x.slug)?.nameFa ?? x.slug}</span>
                              <span className="num shrink-0 text-muted">{x.weight > 0 ? ts('prSet', { weight: fmtNum(x.weight, d), reps: fmtNum(x.reps, d) }) : ts('prSetBw', { reps: fmtNum(x.reps, d) })}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {thumb && urls.get(thumb.id) && (
                      <Link href={`/progress/photos/compare?b=${e.date}`} className="mt-2 block w-20">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                        <img src={urls.get(thumb.id)} alt="" className="aspect-[3/4] w-full rounded-lg bg-surface-2 object-cover" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
