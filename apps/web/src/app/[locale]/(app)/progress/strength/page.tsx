import { getTranslations, setRequestLocale } from 'next-intl/server';
import { addDays, COACH, countVolume, e1rmSeries, isNovice, muscleVolume, setsFor, weekContext, weekOfDate, weeklyVolume } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { IconTrophy } from '@/components/icons';
import { BarChart } from '@/components/progress/BarChart';
import { LineChart } from '@/components/progress/LineChart';
import { ProgressHeader } from '@/components/progress/ProgressNav';
import { Status } from '@/components/progress/Status';
import { fmtDate, fmtNum } from '@/lib/format';
import { librarySlugMap } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { firstTimes, loadMainLifts, loadPRs, loadWorkSets } from '@/lib/progress';
import { loadActiveMeso, mesoInfo } from '@/lib/training';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';
const P = COACH.progress;

export default async function StrengthPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress.strength');
  const tw = await getTranslations('workout');
  const tg = await getTranslations('gym');
  const tc = await getTranslations('common');
  const today = await localToday();
  const d = profile.digits;
  const [{ sets }, mains, prs, bySlug, block] = await Promise.all([loadWorkSets(sb), loadMainLifts(sb), loadPRs(sb), librarySlugMap(), loadActiveMeso(sb)]);
  const name = (slug: string) => bySlug.get(slug)?.nameFa ?? slug;

  if (!sets.length) {
    return (
      <div className="space-y-4">
        <ProgressHeader active="strength" />
        <section className="card"><p className="text-muted">{t('noData')}</p></section>
      </div>
    );
  }

  // e1RM small multiples: the most-trained main lifts, on one shared time axis.
  const series = mains.map((slug) => ({ slug, pts: e1rmSeries(sets, slug) }))
    .filter((x) => x.pts.length >= 2).sort((a, b) => b.pts.length - a.pts.length).slice(0, P.strengthCharts);
  const domain = { from: sets[0]!.date, to: today };

  // Weekly tonnage, empty weeks included so gaps read as gaps.
  const weeks = weeklyVolume(sets, bySlug);
  const thisWeek = weekOfDate(today);
  const firstWeek = [weeks[0]!.week, addDays(thisWeek, -7 * (P.volumeWeeks - 1))].sort()[1]!;
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  const bars = [];
  for (let w = firstWeek; w <= thisWeek; w = addDays(w, 7)) {
    const v = byWeek.get(w);
    bars.push({
      key: w, label: fmtDate(w, d, { day: 'numeric', month: 'short' }), value: v?.tonnage ?? 0, partial: w === thisWeek,
      detail: `${t('weekOf', { date: fmtDate(w, d, { day: 'numeric', month: 'long' }) })} · ${t('setsDetail', { n: fmtNum(v?.sets ?? 0, d) })}`,
    });
  }

  // Sets per muscle for one week: the last finished week by default.
  const which = (await searchParams).week === 'this' ? 'this' : 'last';
  const shown = which === 'this' ? thisWeek : addDays(thisWeek, -7);
  const exp = profile.experience ?? 'none';
  // What the active block planned for that week (sets per muscle), when the week falls inside it.
  const planned = block && addDays(shown, 6) >= block.meso.startDate
    ? countVolume(block.days.flatMap((day) => day.exercises.map((x) => ({
      slug: x.slug, sets: setsFor(x.sets, weekContext(mesoInfo(block.meso), exp, [shown, block.meso.startDate].sort()[1]!)),
    }))), bySlug)
    : undefined;
  const muscles = muscleVolume(byWeek.get(shown)?.muscles, isNovice(exp), planned);
  const scale = Math.max(...muscles.map((m) => Math.max(m.sets, m.hi))) + 2;

  // One PR line per exercise per day; an exercise's first session is its baseline, not a record.
  const first = firstTimes(sets);
  const seen = new Set<string>();
  const prList = prs.filter((p) => first.get(p.slug) !== p.date && !seen.has(`${p.date}|${p.slug}`) && seen.add(`${p.date}|${p.slug}`)).slice(0, 20);

  return (
    <div className="space-y-4">
      <ProgressHeader active="strength" />

      <section className="card" aria-labelledby="e-h">
        <h2 id="e-h" className="card-title">{t('e1rmTitle')}</h2>
        <p className="field-hint">{t('e1rmHint')}</p>
        <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {series.map(({ slug, pts }) => {
            const pct = (pts.at(-1)!.kg / pts[0]!.kg - 1) * 100;
            return (
              <figure key={slug} className="m-0">
                <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <Link href={`/workout/library/${slug}`} className="font-bold hover:text-accent-text">{name(slug)}</Link>
                  <span className="text-xs text-muted"><span className="num" dir="ltr">{pct >= 0 ? '+' : '−'}{fmtNum(Math.abs(pct), d, { maximumFractionDigits: 0 })}٪</span> {t('fromStart')}</span>
                </figcaption>
                <LineChart points={pts.map((p) => ({ date: p.date, value: p.kg }))} domain={domain} unit={tc('kg')} digits={d} label={name(slug)} />
              </figure>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="v-h">
        <h2 id="v-h" className="card-title">{t('volumeTitle')}</h2>
        <p className="field-hint">{t('volumeHint')}</p>
        <div className="mt-3">
          <BarChart bars={bars} unit={tc('kg')} digits={d} label={t('volumeTitle')} partialNote={t('partial')} />
        </div>
      </section>

      <section className="card" aria-labelledby="m-h" id="muscles">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="m-h" className="card-title">{t('musclesTitle')}</h2>
          <nav className="flex rounded-xl bg-surface-2 p-1 text-sm" aria-label={t('musclesTitle')}>
            {(['last', 'this'] as const).map((k) => (
              <Link key={k} href={`/progress/strength?week=${k}#muscles`} aria-current={k === which ? 'true' : undefined}
                className={`rounded-lg px-3 py-1.5 ${k === which ? 'bg-surface font-bold text-fg shadow' : 'text-muted hover:text-fg'}`}>
                {t(k === 'last' ? 'lastWeek' : 'thisWeek')}
              </Link>
            ))}
          </nav>
        </div>
        <p className="field-hint">{t('musclesHint', { hi: fmtNum(muscles[0]!.hi, d) })}</p>
        <ul className="mt-4 space-y-3">
          {muscles.map((m) => (
            <li key={m.muscle} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-sm">
              <span className="truncate">{tw(`muscle.${m.muscle}`)}</span>
              <span className="relative h-3 rounded-full bg-surface-2" aria-hidden="true">
                <span className="absolute inset-y-0 rounded-full" style={{ insetInlineStart: `${(m.lo / scale) * 100}%`, width: `${((m.hi - m.lo) / scale) * 100}%`, background: 'color-mix(in srgb, var(--chart-plan) 28%, transparent)' }} />
                {m.sets > 0 && <span className="absolute inset-y-0.5 start-0 rounded-full bg-[var(--chart-trend)]" style={{ width: `${(m.sets / scale) * 100}%` }} />}
              </span>
              <span className="flex items-center justify-end gap-2">
                <b className="num">{fmtNum(m.sets, d, { maximumFractionDigits: 1 })}</b>
                {m.status === 'ok'
                  ? <span className="sr-only">{t('ok')}</span>
                  : <Status tone={m.status === 'low' ? 'muted' : 'warn'} size="sm">{t(m.status)}</Status>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="pr-h">
        <h2 id="pr-h" className="card-title">{t('prsTitle')}</h2>
        <p className="field-hint">{t('prsHint')}</p>
        {prList.length === 0 ? <p className="mt-2 text-muted">{t('prsEmpty')}</p> : (
          <ul className="mt-3 divide-y divide-line">
            {prList.map((p) => (
              <li key={`${p.date}|${p.slug}`} className="flex items-center gap-3 py-2.5">
                <IconTrophy className="h-5 w-5 shrink-0 text-accent-text" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name(p.slug)}</p>
                  <p className="text-xs text-muted">{fmtDate(p.date, d, { day: 'numeric', month: 'long' })} · {p.kinds.map((k) => tg(`prKind.${k}`)).join('، ')}</p>
                </div>
                <b className="num shrink-0">{p.weight > 0 ? t('prSet', { weight: fmtNum(p.weight, d), reps: fmtNum(p.reps, d) }) : t('prSetBw', { reps: fmtNum(p.reps, d) })}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
