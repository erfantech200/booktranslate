'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MEASURES, type Measure } from '@coach/core/shared';
import { fmtNum, isoToday, type Digits } from '@/lib/format';
import { saveMeasurements, type MeasureState } from '@/lib/progressActions';

type Values = Partial<Record<Measure, number | null>>;

/** Tape measurements for today (the phone's local date); only filled fields are saved. */
export function MeasureForm({ last, byDate, digits }: { last: Values; byDate: Record<string, Values>; digits: Digits }) {
  const t = useTranslations('progress.body');
  const tc = useTranslations('common');
  const [today, setToday] = useState<string | null>(null);
  const [state, action, pending] = useActionState<MeasureState, FormData>(saveMeasurements, null);
  useEffect(() => setToday(isoToday()), []);
  const todays = today ? byDate[today] : undefined;

  return (
    <form action={action} key={today ?? ''}>
      <input type="hidden" name="date" value={today ?? ''} />
      <div className="grid grid-cols-2 gap-3">
        {MEASURES.map((k) => (
          <label key={k} className="field">
            <span className="field-label">{t(k)}</span>
            {/* The number is typed left to right, so the unit sits on the input's physical left. */}
            <span className="relative block">
              <input name={k} inputMode="decimal" dir="ltr" autoComplete="off" className="input num pl-20 text-lg font-bold"
                defaultValue={state?.values?.[k] ?? (todays?.[k] != null ? String(todays[k]) : '')} placeholder={last[k] != null ? String(last[k]) : ''}
                aria-describedby={last[k] != null ? `${k}-last` : undefined} />
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-muted">{tc('cm')}</span>
            </span>
            {last[k] != null && <span id={`${k}-last`} className="field-hint num">{t('last', { v: fmtNum(last[k]!, digits) })}</span>}
          </label>
        ))}
      </div>
      <button className="btn btn-primary mt-4 w-full" disabled={pending || !today}>{t('save')}</button>
      {state?.ok && <p role="status" className="note note-ok mt-3">{t('saved')}</p>}
      {state?.error && (
        <p role="alert" className="note note-danger mt-3">
          {state.error === 'empty' ? t('empty') : state.error === 'invalid' ? t('invalid', { field: t(state.field as Measure) }) : tc('error')}
        </p>
      )}
    </form>
  );
}
