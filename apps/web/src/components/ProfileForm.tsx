'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  BODY_AREAS, COACH, CUISINES, defaultGainRate, defaultTarget12m, EQUIPMENT, EXPERIENCE, profileCrossIssues, ProfileFields,
  SettingsInput, type Experience,
} from '@coach/core/shared';
import { useRouter } from '@/i18n/navigation';
import { latinDigits, normalizeDigits } from '@/lib/digits';
import { isoToday } from '@/lib/format';
import { saveOnboarding, saveSettings } from '@/lib/profileActions';

export type FormValues = Record<string, string | string[] | boolean>;

const SECTIONS = {
  body: ['sex', 'age', 'heightCm', 'weightKg', 'waistCm', 'chestCm', 'armCm', 'thighCm'],
  training: ['experience', 'trainLocation', 'equipment', 'dumbbellMinKg', 'dumbbellMaxKg'],
  schedule: ['daysPerWeek', 'sessionMinutes', 'preferredDays'],
  health: ['injuryAreas', 'injuryNotes', 'cardioRisk', 'medicalNotes', 'dailyActivity'],
  food: ['cuisines', 'dislikedFoods', 'allergies', 'dietaryRules', 'cookingMinutes', 'budget', 'mealsPerDay', 'appetite'],
  goal: ['targetGainPctWeek', 'targetWeight12mKg'],
} as const;
type Section = keyof typeof SECTIONS;
const ORDER = Object.keys(SECTIONS) as Section[];

const ERROR_KEYS: Record<string, string> = {
  equipment_required: 'equipmentRequired', match_days: 'matchDays', below_current: 'belowCurrent', range: 'range',
};

/**
 * Onboarding (mode "wizard": one section per step, then save and continue to photos) and
 * Settings (mode "page": every section except body measurements, one save button).
 */
export function ProfileForm({ mode, initial, currentWeightKg, startWeightKg }: {
  mode: 'wizard' | 'page';
  initial: FormValues;
  /** Settings: latest weigh-in (weekly kg at the current rate). */
  currentWeightKg?: number | null;
  /** Settings: start weight; the plan line and the default 12-month target start from it. */
  startWeightKg?: number | null;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const to = useTranslations('onboarding');
  const router = useRouter();
  const [v, setV] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [customRate, setCustomRate] = useState(!!initial.targetGainPctWeek);

  const sections = mode === 'wizard' ? ORDER : ORDER.filter((s) => s !== 'body');
  const visible = mode === 'wizard' ? [sections[step]!] : sections;

  const set = (k: string, val: string | string[] | boolean) => {
    setV((cur) => ({ ...cur, [k]: val }));
    setErrors((e) => { const { [k]: _, ...rest } = e; return rest; });
    setSaved(false);
  };
  const toggle = (k: string, item: string) => {
    const cur = (v[k] as string[]) ?? [];
    set(k, cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item]);
  };
  const str = (k: string) => (v[k] as string | undefined) ?? '';
  const payload = () => {
    const p: Record<string, unknown> = { ...normalizeDigits(v) };
    p.preferredDays = ((v.preferredDays as string[]) ?? []).map(Number);
    if (!customRate) p.targetGainPctWeek = '';
    return p;
  };

  const issuesToErrors = (issues: { path: string; code: string }[]) =>
    Object.fromEntries(issues.map((i) => [i.path, t(ERROR_KEYS[i.code] ?? 'invalid')]));

  function validateStep(section: Section): boolean {
    const keys = SECTIONS[section].filter((k) => k in ProfileFields.shape) as (keyof typeof ProfileFields.shape)[];
    const pick = Object.fromEntries(keys.map((k) => [k, true])) as Record<string, true>;
    const r = ProfileFields.pick(pick as never).safeParse(payload());
    const issues = r.success ? [] : r.error.issues.map((i) => ({ path: String(i.path[0]), code: 'invalid' }));
    if (r.success) {
      // Cross-field rules on what has been parsed so far (body weight from step 1 for the goal check).
      const filled = Object.fromEntries(Object.entries(payload()).filter(([, x]) => x !== '' && x !== undefined));
      const sofar = ProfileFields.partial().safeParse(filled);
      if (sofar.success) issues.push(...profileCrossIssues(sofar.data).filter((i) => keys.includes(i.path as never)).map((i) => ({ path: i.path, code: i.message })));
    }
    if (issues.length === 0) return true;
    setErrors(issuesToErrors(issues));
    return false;
  }

  /** Server rejected something: show it on the step that owns the field. */
  function showServerIssues(issues: { path: string; code: string }[]) {
    setErrors(issuesToErrors(issues));
    const idx = sections.findIndex((s) => issues.some((i) => (SECTIONS[s] as readonly string[]).includes(i.path)));
    if (mode === 'wizard' && idx >= 0) setStep(idx);
  }

  function submit() {
    start(async () => {
      if (mode === 'wizard') {
        const r = await saveOnboarding(payload(), isoToday());
        if (!r.ok) { showServerIssues(r.issues); return; }
        router.push('/onboarding/photos');
      } else {
        const local = SettingsInput.safeParse(payload());
        if (!local.success) { setErrors(issuesToErrors(local.error.issues.map((i) => ({ path: String(i.path[0]), code: i.code === 'custom' ? i.message : 'invalid' })))); return; }
        const r = await saveSettings(payload());
        if (!r.ok) { showServerIssues(r.issues); return; }
        setSaved(true);
        router.refresh();
      }
    });
  }

  // Goal defaults, computed by the same engine the server uses.
  const weight = Number(latinDigits(str('weightKg'))) || currentWeightKg || null;
  const exp = (str('experience') || 'none') as Experience;
  const ratePct = customRate && Number(latinDigits(str('targetGainPctWeek'))) ? Number(latinDigits(str('targetGainPctWeek'))) : defaultGainRate(exp);
  const planStart = startWeightKg ?? weight;
  const targetDefault = useMemo(() => (planStart ? defaultTarget12m(planStart, exp, customRate ? ratePct : null) : null), [planStart, exp, customRate, ratePct]);

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (mode === 'wizard' && step < sections.length - 1) { if (validateStep(sections[step]!)) setStep(step + 1); } else if (mode === 'page' || validateStep(sections[step]!)) submit(); }}
      className="space-y-6" noValidate>
      {mode === 'wizard' && (
        <div>
          <p className="text-sm text-muted">{to('step', { n: step + 1, total: sections.length })}</p>
          <div className="mt-2 flex gap-1.5" aria-hidden="true">
            {sections.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-line'}`} />)}
          </div>
        </div>
      )}

      {visible.map((section) => (
        <section key={section} className={mode === 'page' ? 'card space-y-5' : 'rise space-y-5'}>
          <h2 className="text-xl font-extrabold">{to(`steps.${section}`)}</h2>

          {section === 'body' && <>
            <Chips label={t('sex')} name="sex" value={str('sex')} onChange={(x) => set('sex', x)} error={errors.sex}
              options={[['male', t('male')], ['female', t('female')]]} />
            <div className="grid grid-cols-2 gap-3">
              <NumField label={t('age')} name="age" value={str('age')} set={set} error={errors.age} />
              <NumField label={t('height')} name="heightCm" value={str('heightCm')} set={set} error={errors.heightCm} />
              <NumField label={t('weight')} name="weightKg" value={str('weightKg')} set={set} error={errors.weightKg} />
              <NumField label={t('waist')} name="waistCm" value={str('waistCm')} set={set} error={errors.waistCm} />
            </div>
            <p className="field-hint -mt-2">{t('waistHint')}</p>
            <details className="rounded-xl border border-line px-4 py-3">
              <summary className="cursor-pointer font-medium">{t('moreMeasures')} <span className="text-sm text-muted">({tc('optional')})</span></summary>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <NumField label={t('chest')} name="chestCm" value={str('chestCm')} set={set} error={errors.chestCm} />
                <NumField label={t('arm')} name="armCm" value={str('armCm')} set={set} error={errors.armCm} />
                <NumField label={t('thigh')} name="thighCm" value={str('thighCm')} set={set} error={errors.thighCm} />
              </div>
            </details>
          </>}

          {section === 'training' && <>
            <Chips label={t('experience')} name="experience" value={str('experience')} onChange={(x) => set('experience', x)} error={errors.experience}
              options={EXPERIENCE.map((e) => [e, t(`exp.${e}`)])} />
            <Chips label={t('location')} name="trainLocation" value={str('trainLocation')} onChange={(x) => set('trainLocation', x)} error={errors.trainLocation}
              options={[['gym', t('gym')], ['home', t('home')]]} />
            {str('trainLocation') === 'home' && <>
              <Chips multi label={t('equipment')} name="equipment" values={(v.equipment as string[]) ?? []} onToggle={(x) => toggle('equipment', x)}
                error={errors.equipment} options={EQUIPMENT.map((e) => [e, t(`eq.${e}`)])} />
              {((v.equipment as string[]) ?? []).includes('dumbbells') && (
                <fieldset>
                  <legend className="field-label">{t('dumbbellRange')}</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <NumField label={t('from')} name="dumbbellMinKg" value={str('dumbbellMinKg')} set={set} error={errors.dumbbellMinKg} />
                    <NumField label={t('to')} name="dumbbellMaxKg" value={str('dumbbellMaxKg')} set={set} error={errors.dumbbellMaxKg} />
                  </div>
                </fieldset>
              )}
            </>}
          </>}

          {section === 'schedule' && <>
            <Chips label={t('daysPerWeek')} hint={t('daysPerWeekHint')} name="daysPerWeek" value={str('daysPerWeek')} onChange={(x) => set('daysPerWeek', x)}
              error={errors.daysPerWeek} options={COACH.profile.daysPerWeek.map((n) => [String(n), String(n)])} />
            <Chips label={t('sessionMinutes')} name="sessionMinutes" value={str('sessionMinutes')} onChange={(x) => set('sessionMinutes', x)}
              error={errors.sessionMinutes} options={COACH.profile.sessionMinutes.map((n) => [String(n), String(n)])} />
            <Chips multi label={t('preferredDays')} hint={t('preferredDaysHint')} name="preferredDays" values={(v.preferredDays as string[]) ?? []}
              onToggle={(x) => toggle('preferredDays', x)} error={errors.preferredDays}
              options={(t.raw('weekday') as string[]).map((d, i) => [String(i), d])} />
          </>}

          {section === 'health' && <>
            <Chips multi label={t('injuryAreas')} name="injuryAreas" values={(v.injuryAreas as string[]) ?? []} onToggle={(x) => toggle('injuryAreas', x)}
              error={errors.injuryAreas} options={BODY_AREAS.map((a) => [a, t(`area.${a}`)])} />
            <TextField label={t('injuryNotes')} optional={tc('optional')} name="injuryNotes" value={str('injuryNotes')} set={set} multiline />
            <label className="chip w-full justify-start">
              <input type="checkbox" checked={!!v.cardioRisk} onChange={(e) => set('cardioRisk', e.target.checked)} />
              {t('cardioRisk')}
            </label>
            <TextField label={t('medicalNotes')} optional={tc('optional')} name="medicalNotes" value={str('medicalNotes')} set={set} multiline />
            <Chips label={t('activity')} name="dailyActivity" value={str('dailyActivity')} onChange={(x) => set('dailyActivity', x)} error={errors.dailyActivity}
              options={(['sedentary', 'light', 'active'] as const).map((a) => [a, t(`act.${a}`)])} />
          </>}

          {section === 'food' && <>
            <Chips multi label={t('cuisines')} name="cuisines" values={(v.cuisines as string[]) ?? []} onToggle={(x) => toggle('cuisines', x)}
              error={errors.cuisines} options={CUISINES.map((c) => [c, t(`cuisine.${c}`)])} />
            <TextField label={t('disliked')} optional={tc('optional')} name="dislikedFoods" value={str('dislikedFoods')} set={set} />
            <TextField label={t('allergies')} optional={tc('optional')} name="allergies" value={str('allergies')} set={set} />
            <TextField label={t('dietaryRules')} optional={tc('optional')} name="dietaryRules" value={str('dietaryRules')} set={set} />
            <Chips label={t('cookingMinutes')} name="cookingMinutes" value={str('cookingMinutes')} onChange={(x) => set('cookingMinutes', x)}
              error={errors.cookingMinutes} options={['15', '30', '45', '60', '90'].map((n) => [n, n])} />
            <Chips label={t('budget')} name="budget" value={str('budget')} onChange={(x) => set('budget', x)} error={errors.budget}
              options={(['low', 'medium', 'high'] as const).map((b) => [b, t(`budgetLevel.${b}`)])} />
            <Chips label={t('mealsPerDay')} name="mealsPerDay" value={str('mealsPerDay')} onChange={(x) => set('mealsPerDay', x)} error={errors.mealsPerDay}
              options={COACH.profile.mealsPerDay.map((n) => [String(n), String(n)])} />
            <Chips label={t('appetite')} name="appetite" value={str('appetite')} onChange={(x) => set('appetite', x)} error={errors.appetite}
              options={(['low', 'normal', 'high'] as const).map((a) => [a, t(`appetiteLevel.${a}`)])} />
          </>}

          {section === 'goal' && <>
            <div className="note note-info">{t('honesty')}</div>
            <fieldset className="space-y-3">
              <legend className="field-label">{t('gainRate')}</legend>
              <p className="field-hint mt-0">
                {t('gainRateDefault', { pct: defaultGainRate(exp), kg: weight ? (weight * defaultGainRate(exp) / 100).toFixed(2) : '–' })}
              </p>
              <label className="chip w-full justify-start">
                <input type="checkbox" checked={customRate} onChange={(e) => { setCustomRate(e.target.checked); setSaved(false); }} />
                {t('gainRateCustom')}
              </label>
              {customRate && (
                <NumField label={t('gainRateCustom')} name="targetGainPctWeek" value={str('targetGainPctWeek')} set={set} error={errors.targetGainPctWeek}
                  hint={`${COACH.gainRate.hardMin}–${COACH.gainRate.hardMax}`} />
              )}
            </fieldset>
            <NumField label={t('target12m')} name="targetWeight12mKg" value={str('targetWeight12mKg')} set={set} error={errors.targetWeight12mKg}
              hint={targetDefault ? t('target12mHint', { kg: targetDefault }) : undefined} placeholder={targetDefault ? String(targetDefault) : undefined} />
          </>}
        </section>
      ))}

      <div className="flex items-center gap-3">
        {mode === 'wizard' && step > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={pending}>{tc('back')}</button>
        )}
        <button className="btn btn-primary flex-1" disabled={pending}>
          {mode === 'page' ? tc('save') : step < sections.length - 1 ? tc('next') : to('finish')}
        </button>
      </div>
      {saved && <p role="status" className="note note-ok">{tc('saved')}</p>}
      {Object.keys(errors).length > 0 && mode === 'page' && <p role="alert" className="note note-danger">{tc('error')}</p>}
    </form>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? <span id={id} role="alert" className="mt-1.5 block text-sm text-danger">{error}</span> : null;
}

function NumField({ label, name, value, set, error, hint, placeholder }: {
  label: string; name: string; value: string; set: (k: string, v: string) => void; error?: string; hint?: string; placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input num" name={name} value={value} onChange={(e) => set(name, e.target.value)} inputMode="decimal" dir="ltr"
        autoComplete="off" placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `${name}-err` : undefined} />
      {hint && <span className="field-hint">{hint}</span>}
      <FieldError id={`${name}-err`} error={error} />
    </label>
  );
}

function TextField({ label, optional, name, value, set, multiline }: {
  label: string; optional?: string; name: string; value: string; set: (k: string, v: string) => void; multiline?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label} {optional && <span className="text-sm font-normal text-muted">({optional})</span>}</span>
      {multiline
        ? <textarea className="input" name={name} value={value} onChange={(e) => set(name, e.target.value)} maxLength={1000} rows={3} />
        : <input className="input" name={name} value={value} onChange={(e) => set(name, e.target.value)} maxLength={500} />}
    </label>
  );
}

type ChipProps = { label: string; hint?: string; name: string; error?: string; options: (readonly [string, string])[] | [string, string][] } & (
  | { multi?: false; value: string; onChange: (v: string) => void }
  | { multi: true; values: string[]; onToggle: (v: string) => void }
);

function Chips(p: ChipProps) {
  return (
    <fieldset aria-invalid={!!p.error} aria-describedby={p.error ? `${p.name}-err` : undefined}>
      <legend className="field-label">{p.label}</legend>
      {p.hint && <p className="field-hint mt-0 mb-2.5">{p.hint}</p>}
      <div className="flex flex-wrap gap-2">
        {p.options.map(([val, text]) => (
          <label key={val} className="chip">
            {p.multi
              ? <input type="checkbox" name={p.name} value={val} checked={p.values.includes(val)} onChange={() => p.onToggle(val)} />
              : <input type="radio" name={p.name} value={val} checked={p.value === val} onChange={() => p.onChange(val)} />}
            {text}
          </label>
        ))}
      </div>
      <FieldError id={`${p.name}-err`} error={p.error} />
    </fieldset>
  );
}
