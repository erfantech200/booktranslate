'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fmtNum, isoToday, type Digits } from '@/lib/format';
import { logWeight, type WeighInState } from '@/lib/weightActions';
import { IconCheck } from './icons';

/**
 * Today's weigh-in. "Today" is the phone's local date (decided here, in the browser), so a
 * weigh-in at 7 am counts for the right day whatever the server's time zone.
 */
export function WeighInCard({ recent, avg7, digits }: { recent: { date: string; weightKg: number }[]; avg7: number | null; digits: Digits }) {
  const t = useTranslations('today');
  const tw = useTranslations('weighIn');
  const tc = useTranslations('common');
  const [today, setToday] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<WeighInState, FormData>(logWeight, null);
  useEffect(() => setToday(isoToday()), []);
  useEffect(() => { if (state?.ok) setEditing(false); }, [state]);

  const todays = today ? recent.find((r) => r.date === today) : undefined;
  const showForm = today !== null && (!todays || editing);

  return (
    <section className="card" aria-labelledby="weigh-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="weigh-h" className="card-title">{t('weighIn')}</h2>
        {avg7 != null && <span className="text-sm text-muted">{t('avg7')}: <b className="num font-bold text-fg">{fmtNum(avg7, digits)}</b></span>}
      </div>
      {todays && !editing && (
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ok-soft text-ok"><IconCheck className="h-5 w-5" /></span>
          <p className="text-3xl font-extrabold">{fmtNum(todays.weightKg, digits)} <span className="text-base font-medium text-muted">{t('logged')}</span></p>
          <button type="button" className="btn btn-ghost ms-auto" onClick={() => setEditing(true)}>{tw('update')}</button>
        </div>
      )}
      {showForm && (
        <form action={action} className="mt-3">
          <input type="hidden" name="date" value={today ?? ''} />
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="sr-only">{tw('label')}</span>
              <input name="weight" inputMode="decimal" dir="ltr" required autoComplete="off" placeholder={recent.at(-1) ? String(recent.at(-1)!.weightKg) : '70.0'}
                className="input num text-center text-2xl font-bold" aria-describedby="weigh-hint" defaultValue={todays ? String(todays.weightKg) : ''} />
            </label>
            <button className="btn btn-primary" disabled={pending}>{tw('submit')}</button>
          </div>
          <p id="weigh-hint" className="field-hint">{t('weighInHint')}</p>
          {state?.error && <p role="alert" className="note note-danger mt-3">{state.error === 'invalid' ? tw('invalid') : tc('error')}</p>}
        </form>
      )}
    </section>
  );
}
