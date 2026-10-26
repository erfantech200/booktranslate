'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { saveReadiness, type ReadinessState } from '@/lib/workoutActions';
import { fmtNum, type Digits } from '@/lib/format';
import { LocalDate } from './LocalDate';

type R = { sleepHours: number | null; energy: number | null; soreness: number | null };

/** Optional daily check (spec §6): sleep, energy 1–5, soreness 1–5. Low → suggest dropping a set. */
export function ReadinessCard({ today, entry, low, digits }: { today: string; entry: R | null; low: boolean; digits: Digits }) {
  const t = useTranslations('workout');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ReadinessState, FormData>(saveReadiness, null);
  const [open, setOpen] = useState(!entry);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const scale = (name: 'energy' | 'soreness', v: number | null) => (
    <fieldset className="mt-3">
      <legend className="field-label">{t(name)}</legend>
      <div className="flex items-center gap-1.5">
        <span className="w-8 text-xs text-muted">{t('scaleLow')}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="chip min-w-0 flex-1 px-0 num">
            <input type="radio" name={name} value={n} defaultChecked={v === n} />{fmtNum(n, digits)}
          </label>
        ))}
        <span className="w-8 text-end text-xs text-muted">{t('scaleHigh')}</span>
      </div>
    </fieldset>
  );
  return (
    <section className="card" aria-labelledby="ready-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ready-h" className="card-title">{t('readinessTitle')}</h2>
        {entry && !open && <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>{t('readinessSave')}</button>}
      </div>
      {entry && !open && (
        <p className="mt-2 text-sm text-muted num">
          {t('sleep')}: <b className="text-fg">{entry.sleepHours != null ? fmtNum(entry.sleepHours, digits) : '–'}</b>
          {' · '}{t('energy')}: <b className="text-fg">{entry.energy != null ? fmtNum(entry.energy, digits) : '–'}</b>
          {' · '}{t('soreness')}: <b className="text-fg">{entry.soreness != null ? fmtNum(entry.soreness, digits) : '–'}</b>
        </p>
      )}
      {low && !open && <p role="note" className="note note-warn mt-3">{t('readinessLow')}</p>}
      {open && (
        <form action={action} className="mt-1">
          <p className="field-hint mt-0">{t('readinessHint')}</p>
          <LocalDate fallback={today} />
          <label className="field mt-3">
            <span className="field-label">{t('sleep')}</span>
            <input name="sleepHours" inputMode="decimal" dir="ltr" className="input num w-28 text-center" defaultValue={entry?.sleepHours ?? ''} placeholder="7.5" />
          </label>
          {scale('energy', entry?.energy ?? null)}
          {scale('soreness', entry?.soreness ?? null)}
          <button className="btn btn-secondary mt-4 w-full" disabled={pending}>{t('readinessSave')}</button>
          {state?.error && <p role="alert" className="note note-danger mt-3">{tc('error')}</p>}
        </form>
      )}
    </section>
  );
}
