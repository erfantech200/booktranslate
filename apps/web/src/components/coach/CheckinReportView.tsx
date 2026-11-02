import { getTranslations } from 'next-intl/server';
import type { CheckinReport } from '@coach/core/shared';
import { fmtDate, fmtNum, type Digits } from '@/lib/format';

/** The engine's numbers for one week (spec §11): weight, calories, training, adherence. */
export async function CheckinReportView({ r, names, digits }: { r: CheckinReport; names: Record<string, string>; digits: Digits }) {
  const t = await getTranslations('checkin');
  const tp = await getTranslations('pain');
  const d = digits;
  const n = (x: number, f = 2) => fmtNum(x, d, { maximumFractionDigits: f });
  const signed = (x: number, f = 2) => <span className="num" dir="ltr">{x > 0 ? '+' : x < 0 ? '−' : '±'}{n(Math.abs(x), f)}</span>;
  const w = r.weight;
  const a = r.adherence;

  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="ck-w">
        <h2 id="ck-w" className="card-title">{t('weight')}</h2>
        {w.status === 'not_enough' ? <p className="mt-2 text-muted">{t('notEnough', { n: fmtNum(w.weighIns, d) })}</p> : (
          <div className="mt-2 space-y-1">
            <p className="num text-lg font-bold">{t('weightAvg', { kg: n(w.thisAvg!, 1) })}</p>
            {w.weekChange != null && <p className="text-sm text-muted">{t('weekChange')}: {signed(w.weekChange)} {t('weekChangeUnit')}</p>}
            {w.rate2w != null && <p className="num text-sm text-muted">{t('rate', { rate: n(w.rate2w), target: n(w.targetRate) })}</p>}
          </div>
        )}
        {(r.waistPerMonth != null || r.strengthPct != null) && (
          <p className="mt-2 text-xs text-muted">
            {r.waistPerMonth != null && <>{t('waist')}: {signed(r.waistPerMonth, 1)} {t('waistUnit')}</>}
            {r.waistPerMonth != null && r.strengthPct != null && ' · '}
            {r.strengthPct != null && <>{t('strength')}: {signed(r.strengthPct, 1)}{t('strengthUnit')}</>}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="ck-c">
        <h2 id="ck-c" className="card-title">{t('calories')}</h2>
        <p className="mt-2">
          {r.calories.delta !== 0
            ? <>{t('caloriesChange')} {signed(r.calories.delta, 0)} {t('caloriesUnit')}</>
            : t(`caloriesKeep.${r.calories.reason}`)}
        </p>
      </section>

      <section className="card" aria-labelledby="ck-t">
        <h2 id="ck-t" className="card-title">{t('training')}</h2>
        {r.training.length === 0 ? <p className="mt-2 text-muted">{t('noTrainingNotes')}</p> : (
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {r.training.map((x, i) => (
              <li key={i}>
                {x.kind === 'swap' ? (x.to ? t('notes.swap', { exercise: names[x.slug] ?? x.slug }) : t('notes.swapNoAlt', { exercise: names[x.slug] ?? x.slug }))
                  : x.kind === 'early_deload' ? t('notes.early_deload')
                    : x.kind === 'recovery' ? t('notes.recovery', { n: fmtNum(x.lowDays, d) })
                      : x.kind === 'pain' ? t('notes.pain', { areas: x.areas.map((ar) => tp(`areas.${ar}`)).join('، ') })
                        : t('notes.missed', { done: fmtNum(x.done, d), planned: fmtNum(x.planned, d) })}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">{t('prs', { n: r.prs, count: fmtNum(r.prs, d) })}</p>
      </section>

      <section className="card" aria-labelledby="ck-a">
        <h2 id="ck-a" className="card-title">{t('adherence')}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {([
            [t('workouts'), a.workoutsDone, a.workoutsPlanned],
            [t('proteinDays'), a.proteinDays, 7],
            [t('kcalDays'), a.kcalDays, 7],
          ] as const).map(([label, v, total]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-2 py-3">
              <dd className="num text-xl font-extrabold">{fmtNum(v, d)}<span className="text-sm font-normal text-muted">/{fmtNum(total, d)}</span></dd>
              <dt className="mt-0.5 text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </section>
      <p className="text-center text-xs text-muted">{t('week', { from: fmtDate(r.weekStart, d, { day: 'numeric', month: 'short' }), to: fmtDate(r.weekEnd, d, { day: 'numeric', month: 'short' }) })}</p>
    </div>
  );
}
