'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { COACH, EQUIPMENT } from '@coach/core/shared';
import { useRouter } from '@/i18n/navigation';
import { createProgram } from '@/lib/programActions';
import { Chips } from '../ProfileForm';

const ERROR_KEYS: Record<string, string> = { equipment_required: 'equipmentRequired', match_days: 'matchDays' };

/** New training program: its own place, equipment and schedule. It starts today and becomes active. */
export function ProgramForm({ initial }: {
  initial: { trainLocation: string; equipment: string[]; daysPerWeek: string; sessionMinutes: string; preferredDays: string[] };
}) {
  const t = useTranslations('profile');
  const tp = useTranslations('programs');
  const tc = useTranslations('common');
  const router = useRouter();
  const [v, setV] = useState({ name: '', ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [pending, start] = useTransition();

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setV((cur) => ({ ...cur, [k]: val }));
    setErrors((e) => { const { [k]: _, ...rest } = e; return rest; });
  };
  const toggle = (k: 'equipment' | 'preferredDays', item: string) =>
    set(k, v[k].includes(item) ? v[k].filter((x) => x !== item) : [...v[k], item]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createProgram({ ...v, preferredDays: v.preferredDays.map(Number) });
      if (r.ok) { router.push('/workout'); return; }
      setRunning(r.issues.some((i) => i.code === 'workout_running'));
      setErrors(Object.fromEntries(r.issues.filter((i) => i.path).map((i) => [i.path, t(ERROR_KEYS[i.code] ?? 'invalid')])));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <label className="field">
        <span className="field-label">{tp('name')} <span className="text-sm font-normal text-muted">({tc('optional')})</span></span>
        <input className="input" name="name" value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={60} placeholder={tp('namePlaceholder')} />
      </label>
      <Chips label={t('location')} name="trainLocation" value={v.trainLocation} onChange={(x) => set('trainLocation', x)} error={errors.trainLocation}
        options={[['gym', t('gym')], ['home', t('home')]]} />
      {v.trainLocation === 'home' && (
        <Chips multi label={t('equipment')} name="equipment" values={v.equipment} onToggle={(x) => toggle('equipment', x)}
          error={errors.equipment} options={EQUIPMENT.map((e) => [e, t(`eq.${e}`)])} />
      )}
      <Chips label={t('daysPerWeek')} hint={t('daysPerWeekHint')} name="daysPerWeek" value={v.daysPerWeek} onChange={(x) => { set('daysPerWeek', x); if (v.preferredDays.length && v.preferredDays.length !== Number(x)) set('preferredDays', []); }}
        error={errors.daysPerWeek} options={COACH.profile.daysPerWeek.map((n) => [String(n), String(n)])} />
      <Chips label={t('sessionMinutes')} name="sessionMinutes" value={v.sessionMinutes} onChange={(x) => set('sessionMinutes', x)}
        error={errors.sessionMinutes} options={COACH.profile.sessionMinutes.map((n) => [String(n), String(n)])} />
      <Chips multi label={t('preferredDays')} hint={t('preferredDaysHint')} name="preferredDays" values={v.preferredDays}
        onToggle={(x) => toggle('preferredDays', x)} error={errors.preferredDays}
        options={(t.raw('weekday') as string[]).map((d, i) => [String(i), d])} />
      <p className="field-hint">{tp('ownSettings')}</p>
      {running && <p role="alert" className="note note-warn">{tp('workoutRunning')}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? tp('creating') : tp('create')}</button>
      <p className="field-hint text-center">{tp('newHint')}</p>
    </form>
  );
}
