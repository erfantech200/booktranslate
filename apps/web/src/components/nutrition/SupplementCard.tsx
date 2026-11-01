import { getTranslations } from 'next-intl/server';
import type { DaySupplements } from '@coach/core/shared';
import { fmtNum, type Digits } from '@/lib/format';
import { toggleCreatine } from '@/lib/supplementActions';
import { IconCheck } from '../icons';

/**
 * The day's supplements (spec §9): creatine, the same dose every day, and the protein powder the
 * meal plan already holds. Vitamins come from food: no doses, a blood test and a doctor if in doubt.
 * The creatine tick exists only for today.
 */
export async function SupplementCard({ sup, isToday, taken, streak, unitFa, digits, compact }: {
  sup: DaySupplements;
  isToday: boolean;
  taken: boolean;
  streak: number;
  unitFa: string | null;
  digits: Digits;
  compact?: boolean;
}) {
  const t = await getTranslations('supplements');
  const n = (x: number) => fmtNum(x, digits);
  const p = sup.proteinPowder;
  const hint = sup.training == null ? t('creatineHintUnknown') : sup.training ? t('creatineHintTraining') : t('creatineHintRest');

  return (
    <section className="card" aria-labelledby="sup-day-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sup-day-h" className="card-title">{isToday ? t('titleToday') : t('titleDay')}</h2>
        {sup.training != null && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${sup.training ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-muted'}`}>
            {sup.training ? t('training') : t('rest')}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{t('creatine')} <span className="num font-normal text-muted">· {t('grams', { g: n(sup.creatineG) })}</span></p>
          {!compact && <p className="text-sm text-muted">{hint}</p>}
          {isToday && streak > 1 && <p className="num text-xs text-muted">{t('streak', { n: n(streak) })}</p>}
        </div>
        {isToday && (
          <form action={toggleCreatine} className="shrink-0">
            <button aria-pressed={taken}
              className={`btn min-h-10 px-3 text-sm ${taken ? 'border-ok/50 bg-ok-soft text-ok' : 'btn-secondary'}`}>
              {taken && <IconCheck className="h-4 w-4" />}{taken ? t('taken') : t('markTaken')}
            </button>
          </form>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <p className="font-bold">{t('powder')}</p>
        <p className="text-sm text-muted">
          {p
            ? (p.units != null && unitFa
              ? t('powderInPlan', { g: n(p.grams), units: n(p.units), unit: unitFa, meals: p.meals.join('، ') })
              : t('powderInPlanNoUnit', { g: n(p.grams), meals: p.meals.join('، ') }))
            : t('powderNone')}
        </p>
      </div>

      {!compact && <p className="field-hint mt-3 border-t border-line pt-3">{t('vitamins')}</p>}
    </section>
  );
}
