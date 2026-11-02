'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { decideAdjustment } from '@/lib/adjustActions';
import { fmtNum, type Digits } from '@/lib/format';
import { IconCheck } from '../icons';

export interface ProposalView {
  id: string;
  source: 'checkin' | 'coach';
  type: 'calories' | 'swap_exercise' | 'early_deload' | 'reschedule_workout' | 'add_note' | 'regenerate_meal';
  before: any;
  after: any;
  reason: string;
  status: 'proposed' | 'approved' | 'dismissed' | 'failed';
  error: string | null;
}

/** One proposed change (check-in or coach): what it does, why, and approve / dismiss. Nothing applies without the tap. */
export function ProposalCard({ p, names, meals, digits }: {
  p: ProposalView; names: Record<string, string>; meals?: Record<string, string>; digits: Digits;
}) {
  const t = useTranslations('proposal');
  const weekdays = useTranslations('profile').raw('weekday') as string[];
  const router = useRouter();
  const [status, setStatus] = useState(p.status);
  const [error, setError] = useState(p.error);
  const [pending, start] = useTransition();
  const n = (x: number) => fmtNum(x, digits);
  const signed = (x: number) => `${x > 0 ? '+' : '−'}${n(Math.abs(x))}`;

  const title = (() => {
    switch (p.type) {
      case 'calories': return t('calories', { delta: signed(p.after.delta), from: n(p.before?.surplus ?? 0), to: n(p.after.surplus) });
      case 'swap_exercise': return t('swap', { from: names[p.after.from] ?? p.after.from, to: names[p.after.to] ?? p.after.to });
      case 'early_deload': return t('earlyDeload');
      case 'reschedule_workout': return p.after.action === 'skip_next' ? t('skipNext') : t('setDays', { days: (p.after.weekdays as number[]).map((d) => weekdays[d]).join('، ') });
      case 'add_note': return t('note', { text: p.after.text });
      case 'regenerate_meal': return t('meal', { name: p.before?.name ?? meals?.[p.after.mealId] ?? '' });
    }
  })();
  const reason = p.source === 'checkin' && t.has(`reason.${p.reason}`) ? t(`reason.${p.reason}`) : p.reason;

  const decide = (approve: boolean) => start(async () => {
    const r = await decideAdjustment(p.id, approve);
    if (r.ok) setStatus(approve ? 'approved' : 'dismissed');
    else { setStatus(r.error === 'decided' ? status : 'failed'); setError(r.error ?? 'failed'); }
    router.refresh();
  });

  return (
    <div className={`rounded-xl border p-3 ${status === 'proposed' ? 'border-accent/60 bg-accent-soft/40' : 'border-line bg-surface-2'}`}>
      <p className="font-bold" dir="auto">{title}</p>
      <p className="mt-0.5 text-sm text-muted" dir="auto">{reason}</p>
      {status === 'proposed' ? (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-primary min-h-10 flex-1" disabled={pending} onClick={() => decide(true)}>{t('approve')}</button>
          <button type="button" className="btn btn-ghost min-h-10" disabled={pending} onClick={() => decide(false)}>{t('dismiss')}</button>
        </div>
      ) : (
        <p className={`mt-2 inline-flex items-center gap-1.5 text-sm font-bold ${status === 'approved' ? 'text-ok' : status === 'failed' ? 'text-danger' : 'text-muted'}`}>
          {status === 'approved' && <IconCheck className="h-4 w-4" />}
          {t(status)}{status === 'failed' && error ? `: ${t.has(`errors.${error}`) ? t(`errors.${error}`) : error}` : ''}
        </p>
      )}
      {status === 'approved' && p.type === 'add_note' && (
        <button type="button" className="btn btn-ghost mt-1 min-h-8 px-1 text-xs" disabled={pending} onClick={() => decide(false)}>{t('removeNote')}</button>
      )}
    </div>
  );
}
