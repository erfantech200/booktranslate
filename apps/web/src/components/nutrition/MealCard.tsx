'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { fmtNum, isoToday, type Digits } from '@/lib/format';
import { swapMeal, togglePlannedMeal } from '@/lib/nutritionActions';

export interface MealView {
  id: string; slot: string; nameFa: string; cookMinutes: number; kcal: number; protein: number;
  items: { name: string; grams: number; unit: string | null }[];
}

/** A planned meal: tap to log it as eaten (spec §9), or swap it for a similar one. */
/** `compact`: a checklist row (Today screen) without swap and ingredients. */
export function MealCard({ meal, eaten, digits, interactive = true, compact = false }: { meal: MealView; eaten: boolean; digits: Digits; interactive?: boolean; compact?: boolean }) {
  const t = useTranslations('nutrition');
  const [optimistic, setOptimistic] = useOptimistic(eaten);
  const [pending, start] = useTransition();
  const [swapping, startSwap] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const nf = (n: number) => fmtNum(Math.round(n), digits);
  return (
    <li className={compact ? 'py-2' : `rounded-2xl border p-3.5 transition-colors ${optimistic ? 'border-ok/40 bg-ok-soft/40' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-3">
        {interactive && (
          <button type="button" aria-pressed={optimistic} aria-label={t('ateAsPlanned')} disabled={pending}
            onClick={() => start(async () => { setOptimistic(!optimistic); await togglePlannedMeal(meal.id, isoToday(), !optimistic); })}
            className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors ${optimistic ? 'border-ok bg-ok text-bg' : 'border-line text-transparent hover:border-muted'}`}>
            ✓
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-accent-text">{t(`slot.${meal.slot}`)}</p>
          <p className="font-bold leading-snug">{meal.nameFa}</p>
          <p className="num mt-0.5 text-xs text-muted">
            {nf(meal.kcal)} {t('kcalUnit')} · {nf(meal.protein)} {t('g')} {t('protein')}{meal.cookMinutes > 0 ? ` · ${t('minutes', { n: nf(meal.cookMinutes) })}` : ''}
          </p>
        </div>
        {interactive && !compact && (
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-sm" disabled={swapping}
            onClick={() => startSwap(async () => {
              setMsg(null);
              const r = await swapMeal(meal.id);
              setMsg(!r.ok ? t('swapFailed') : r.fallback ? t('swapFallback') : null);
            })}>
            {swapping ? t('swapping') : t('swap')}
          </button>
        )}
      </div>
      {!compact && <details className="mt-2 ps-11">
        <summary className="cursor-pointer text-xs text-muted">{t('ingredients')}</summary>
        <ul className="mt-1.5 space-y-0.5 text-sm">
          {meal.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span>{i.name}</span>
              <span className="num shrink-0 text-muted">{i.unit ?? `${nf(i.grams)} ${t('g')}`}</span>
            </li>
          ))}
        </ul>
      </details>}
      {msg && <p role="status" className="mt-2 text-xs text-muted">{msg}</p>}
    </li>
  );
}
