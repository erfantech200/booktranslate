import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DayKind, Muscle, SessionPlan, SessionSummary } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { CoachComment } from '@/components/workout/CoachComment';
import { fmtDate, fmtNum } from '@/lib/format';
import { loadLibrary } from '@/lib/library';
import { requireProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

/** Finish screen / past session: duration, volume, sets per muscle, PRs, the coach's comment. */
export default async function SessionPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: s } = await sb.from('workout_sessions').select('*').eq('id', id).maybeSingle();
  if (!s) notFound();
  const t = await getTranslations('session');
  const tw = await getTranslations('workout');
  const tg = await getTranslations('gym');
  const d = profile.digits;
  const nf = (n: number) => fmtNum(n, d);
  const plan = s.plan as SessionPlan | null;
  const summary = s.summary as SessionSummary | null;
  const library = await loadLibrary();
  const byslug = new Map(library.map((e) => [e.slug, e]));
  const { data: sets } = await sb.from('set_logs').select('slug, ex_idx, set_idx, is_warmup, weight_kg, reps, rir').eq('session_id', id).order('ex_idx').order('set_idx');
  const kinds = (plan?.kinds ?? []) as DayKind[];
  const muscles = Object.entries(summary?.setsPerMuscle ?? {}).sort((a, b) => b[1] - a[1]) as [Muscle, number][];
  const maxM = Math.max(1, ...muscles.map(([, n]) => n));

  return (
    <div className="space-y-4 pt-2">
      <header className="rise">
        <p className="text-sm text-muted">{fmtDate(s.date, d, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-3xl font-extrabold">{kinds.map((k) => tw(`days.${k}`)).join(' + ') || t('title')}</h1>
        {s.status === 'skipped' && <p className="mt-1 text-muted">{t('skippedDay')}</p>}
      </header>

      {summary && (
        <section className="card rise grid grid-cols-3 gap-3 text-center" aria-label={t('title')}>
          {[
            [t('duration'), t('minutes', { n: nf(summary.minutes) })],
            [t('sets'), nf(summary.workingSets)],
            [t('volume'), t('volumeKg', { n: nf(summary.volumeKg) })],
          ].map(([k, v]) => (
            <div key={k}><p className="text-xs text-muted">{k}</p><p className="num mt-1 text-xl font-extrabold">{v}</p></div>
          ))}
        </section>
      )}

      {summary && (
        <section className="card" aria-labelledby="pr-h">
          <h2 id="pr-h" className="card-title">{t('prs')}</h2>
          {summary.prs.length === 0 ? <p className="mt-2 text-sm text-muted">{t('noPrs')}</p> : (
            <ul className="mt-2 space-y-2">
              {summary.prs.map((p) => (
                <li key={p.slug} className="rounded-xl bg-accent-soft px-3 py-2">
                  <b className="me-2 text-accent-text">{byslug.get(p.slug)?.nameFa ?? p.slug}</b>
                  <span className="num text-sm" dir="ltr">{nf(p.weight)} × {nf(p.reps)}</span>
                  <p className="text-xs text-muted">{p.kinds.map((k) => tg(`prKind.${k}`)).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {s.status === 'done' && <CoachComment sessionId={s.id} initial={s.coach_comment} status={s.comment_status} />}

      {muscles.length > 0 && (
        <section className="card" aria-labelledby="m-h">
          <h2 id="m-h" className="card-title">{t('perMuscle')}</h2>
          <p className="field-hint mt-0.5">{t('perMuscleHint')}</p>
          <ul className="mt-3 space-y-1.5">
            {muscles.map(([m, n]) => (
              <li key={m} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-sm">
                <span className="truncate">{tw(`muscle.${m}`)}</span>
                <span className="h-2 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent" style={{ width: `${(n / maxM) * 100}%` }} /></span>
                <span className="num text-end text-muted">{nf(n)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && (
        <section className="card" aria-labelledby="ex-h">
          <h2 id="ex-h" className="card-title">{t('exercises')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {plan.exercises.map((x, i) => {
              const mine = (sets ?? []).filter((r) => r.ex_idx === i && !r.is_warmup);
              return (
                <li key={`${i}-${x.slug}`} className="py-2.5">
                  <Link href={`/workout/library/${x.slug}`} className="font-bold">{byslug.get(x.slug)?.nameFa ?? x.slug}</Link>
                  <p className="num text-sm text-muted" dir="auto">
                    {x.skipped && mine.length === 0 ? tg('skipped')
                      : mine.map((r) => (x.timed ? `${nf(r.reps)}″` : `${nf(Number(r.weight_kg))}×${nf(r.reps)}`)).join('، ')}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {s.note && <p className="card whitespace-pre-line text-muted">{s.note}</p>}
      <Link href="/workout" className="btn btn-secondary w-full">{t('back')}</Link>
    </div>
  );
}
