import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { bestE1rm, type Muscle } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { BodyMap } from '@/components/workout/BodyMap';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { HistoryChart } from '@/components/workout/HistoryChart';
import { fmtNum } from '@/lib/format';
import { loadLibrary } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { loadHistory } from '@/lib/training';
import { setExcluded } from '@/lib/workoutActions';

export const dynamic = 'force-dynamic';

/** Exercise page (spec §7): muscles → setup → execution → cues → mistakes → safety → my history → substitutes → demo. */
export default async function ExercisePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const library = await loadLibrary();
  const e = library.find((x) => x.slug === slug);
  if (!e) notFound();
  const t = await getTranslations('library');
  const tw = await getTranslations('workout');
  const tp = await getTranslations('profile');
  const d = profile.digits;
  const nf = (n: number) => fmtNum(n, d);
  const [{ exposures, bests }, { data: pref }] = await Promise.all([
    loadHistory(sb, [slug]),
    sb.from('exercise_prefs').select('excluded, excluded_reason').eq('slug', slug).maybeSingle(),
  ]);
  const xs = exposures.get(slug) ?? [];
  const b = bests.get(slug);
  const useLoad = !e.timed && e.loadType !== 'bodyweight' && e.loadType !== 'band';
  const points = xs.map((x) => ({ date: x.date, v: useLoad ? Math.round(bestE1rm(x.sets) * 10) / 10 : Math.max(...x.sets.map((s) => s.reps)) })).filter((p) => p.v > 0);
  const bestRepsAt = b ? Object.entries(b.repsAt).sort((a, z) => Number(z[0]) - Number(a[0]))[0] : undefined;
  const bySlug = new Map(library.map((x) => [x.slug, x]));
  const links = (title: string, list: string[]) => list.length > 0 && (
    <div>
      {title && <h3 className="text-sm font-bold text-muted">{title}</h3>}
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {list.filter((s) => bySlug.has(s)).map((s) => <li key={s}><Link href={`/workout/library/${s}`} className="chip">{bySlug.get(s)!.nameFa}</Link></li>)}
      </ul>
    </div>
  );
  const areas = (l: string[]) => l.map((a) => tp(`area.${a}`)).join('، ');

  return (
    <article className="space-y-4 pt-2">
      <header className="rise">
        <Link href="/workout/library" className="text-sm text-muted">{t('title')}</Link>
        <h1 className="mt-1 text-3xl font-extrabold">{e.nameFa}</h1>
        <p className="text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>{e.nameEn}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-surface-2 px-2.5 py-1">{tw(`pattern.${e.pattern}`)}</span>
          <span className="rounded-full bg-surface-2 px-2.5 py-1">{t('difficulty')}: {t(`difficultyLevel.${e.difficulty}`)}</span>
          {e.unilateral && <span className="rounded-full bg-surface-2 px-2.5 py-1">{t('unilateral')}</span>}
          <span className="rounded-full bg-surface-2 px-2.5 py-1">{e.equipment.map((set) => set.map((q) => tw(`equipment.${q}`)).join(' + ')).join(' / ')}</span>
        </div>
      </header>

      {pref?.excluded && (
        <section className="card border-danger/50">
          <p className="text-danger">{pref.excluded_reason === 'pain' ? t('excludedNote') : t('excludedManual')}</p>
          <form action={setExcluded.bind(null, slug, false)} className="mt-3"><ConfirmSubmit className="btn btn-secondary w-full">{t('reenable')}</ConfirmSubmit></form>
        </section>
      )}

      <section className="card" aria-labelledby="mus-h">
        <h2 id="mus-h" className="card-title">{t('muscles')}</h2>
        <div className="mt-3"><BodyMap primary={e.primary as Muscle[]} secondary={e.secondary as Muscle[]} labels={{ front: t('front'), back: t('back') }} /></div>
        <p className="mt-3 text-sm"><span className="me-1 inline-block h-2.5 w-2.5 rounded-full bg-accent" /> {t('primary')}: {e.primary.map((m) => tw(`muscle.${m}`)).join('، ')}</p>
        {e.secondary.length > 0 && (
          <p className="mt-1 text-sm text-muted"><span className="me-1 inline-block h-2.5 w-2.5 rounded-full bg-accent/40" /> {t('secondary')}: {e.secondary.map((m) => tw(`muscle.${m}`)).join('، ')}</p>
        )}
      </section>

      <section className="card space-y-4">
        <div><h2 className="card-title">{t('setup')}</h2><ol className="mt-2 list-decimal space-y-1.5 ps-5">{e.setup.map((s) => <li key={s}>{s}</li>)}</ol></div>
        <div><h2 className="card-title">{t('execution')}</h2><ol className="mt-2 list-decimal space-y-1.5 ps-5">{e.execution.map((s) => <li key={s}>{s}</li>)}</ol></div>
        <div>
          <h2 className="card-title">{t('cues')}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">{e.cues.map((c) => <li key={c} className="rounded-xl bg-accent-soft px-3 py-1.5 text-accent-text">{c}</li>)}</ul>
        </div>
        <div>
          <h2 className="card-title">{t('mistakes')}</h2>
          <ul className="mt-2 space-y-2">
            {e.mistakes.map((m) => (
              <li key={m.mistake} className="rounded-xl bg-surface-2 p-3">
                <p className="font-bold">{m.mistake}</p>
                <p className="mt-1 text-[0.9375rem] text-muted"><b className="text-ok">{t('fix')}:</b> {m.fix}</p>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm font-bold text-muted">{t('breathing')}</dt><dd className="mt-1">{e.breathing}</dd></div>
          <div><dt className="text-sm font-bold text-muted">{t('tempo')}</dt><dd className="mt-1">{e.tempo}</dd></div>
        </dl>
      </section>

      <section className="card" aria-labelledby="safe-h">
        <h2 id="safe-h" className="card-title">{t('safety')}</h2>
        <ul className="mt-2 list-disc space-y-1.5 ps-5">{e.safety.map((s) => <li key={s}>{s}</li>)}</ul>
        {e.contraindications.length > 0 && <p className="note note-danger mt-3 text-sm">{t('contraindicated', { areas: areas(e.contraindications) })}</p>}
        {e.cautions.length > 0 && <p className="note note-warn mt-3 text-sm">{t('cautioned', { areas: areas(e.cautions) })}</p>}
      </section>

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h" className="card-title">{t('history')}</h2>
        {points.length === 0 ? <p className="mt-2 text-sm text-muted">{t('noHistory')}</p> : (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div><dt className="text-xs text-muted">{t('sessions')}</dt><dd className="num mt-1 text-lg font-extrabold">{nf(xs.length)}</dd></div>
              {useLoad ? (
                <>
                  <div><dt className="text-xs text-muted">{t('bestLoad')}</dt><dd className="num mt-1 text-lg font-extrabold">{nf(b?.maxWeight ?? 0)}</dd></div>
                  <div><dt className="text-xs text-muted">{t('bestE1rm')}</dt><dd className="num mt-1 text-lg font-extrabold">{nf(Math.round((b?.maxE1rm ?? 0) * 10) / 10)}</dd></div>
                </>
              ) : (
                <div className="col-span-2"><dt className="text-xs text-muted">{t('bestReps')}</dt><dd className="num mt-1 text-lg font-extrabold">{nf(Math.max(...points.map((p) => p.v)))}</dd></div>
              )}
            </dl>
            {useLoad && bestRepsAt && <p className="num mt-2 text-center text-sm text-muted" dir="ltr">{nf(Number(bestRepsAt[0]))} kg × {nf(bestRepsAt[1])}</p>}
            <div className="mt-3"><HistoryChart points={points} digits={d} label={useLoad ? t('e1rmHint') : t('bestReps')} unit={useLoad ? 'kg' : ''} /></div>
          </>
        )}
      </section>

      <section className="card space-y-3" aria-labelledby="sub-h">
        <h2 id="sub-h" className="card-title">{t('substitutes')}</h2>
        {links('', e.substitutes)}
        {links(t('regressions'), e.regressions)}
        {links(t('progressions'), e.progressions)}
      </section>

      <a href={e.videoSearchUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">
        {t('demo')} <span className="text-sm font-normal text-muted">({t('demoHint')})</span>
      </a>
      <p className="text-center text-xs text-muted">{t('imageLater')}</p>

      {!pref?.excluded && (
        <form action={setExcluded.bind(null, slug, true)} className="text-center">
          <ConfirmSubmit className="btn btn-ghost text-sm" confirm={t('excludeHint')}>{t('exclude')}</ConfirmSubmit>
        </form>
      )}
    </article>
  );
}
