'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { mustStop, RED_FLAGS, type RedFlag } from '@coach/core/shared';
import { fmtNum, isoToday, type Digits } from '@/lib/format';
import { reportPain, type PainResult } from '@/lib/workoutActions';
import { Sheet } from './Sheet';

const AREAS = ['shoulder', 'elbow', 'wrist', 'lower_back', 'upper_back', 'neck', 'hip', 'knee', 'ankle', 'other'] as const;

/**
 * Pain report (spec §6). Every message shown here is fixed copy, never generated text: pain ≥ 4
 * or sharp stops the exercise; a red flag stops the session.
 */
export function PainSheet({ open, onClose, sessionId, slug, digits, onResult }: {
  open: boolean; onClose: () => void; sessionId: string; slug: string | null; digits: Digits;
  onResult: (r: PainResult) => void;
}) {
  const t = useTranslations('pain');
  const [level, setLevel] = useState(3);
  const [sharp, setSharp] = useState(false);
  const [area, setArea] = useState<(typeof AREAS)[number]>('knee');
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [result, setResult] = useState<PainResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit() {
    setBusy(true);
    setFailed(false);
    // Decided here too, so the stop message shows even when the report can't be sent.
    const local: PainResult = { stop: flags.length > 0 || mustStop(level, sharp), excluded: false, recurring: false, redFlag: flags.length > 0 };
    try {
      const r = await reportPain({ sessionId, slug, area, level, sharp, redFlag: flags[0] ?? null, date: isoToday() });
      setResult(r);
      onResult(r);
    } catch {
      setFailed(true);
      setResult(local);
      onResult(local);
    } finally {
      setBusy(false);
    }
  }
  const close = () => { setResult(null); setFlags([]); setSharp(false); onClose(); };

  return (
    <Sheet open={open} onClose={close} title={t('title')}>
      {result ? (
        <div className="space-y-3">
          {result.redFlag ? <p role="alert" className="note note-danger font-bold">{t('redFlagStop')}</p>
            : result.stop ? <p role="alert" className="note note-danger">{t('stop')}</p>
            : <p className="note note-info">{t('mild')}</p>}
          {result.recurring && <p className="note note-warn">{t('recurring')}</p>}
          {failed && <p className="text-sm text-muted">{t('failed')}</p>}
          <button type="button" className="btn btn-secondary w-full" onClick={close}>{t('close')}</button>
        </div>
      ) : (
        <div className="space-y-5">
          <label className="field">
            <span className="field-label flex justify-between"><span>{t('level')}</span><b className="num text-xl">{fmtNum(level, digits)}</b></span>
            <input type="range" min={0} max={10} step={1} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="w-full accent-[var(--accent)]" dir="ltr" />
            <span className="field-hint">{t('levelHint')}</span>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sharp} onChange={(e) => setSharp(e.target.checked)} className="h-5 w-5" />{t('sharp')}</label>
          <fieldset>
            <legend className="field-label">{t('area')}</legend>
            <div className="flex flex-wrap gap-2">
              {AREAS.map((a) => (
                <label key={a} className="chip"><input type="radio" name="pain-area" checked={area === a} onChange={() => setArea(a)} />{t(`areas.${a}`)}</label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="field-label">{t('redFlags')}</legend>
            <div className="space-y-2">
              {RED_FLAGS.map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="checkbox" className="h-5 w-5" checked={flags.includes(f)}
                    onChange={(e) => setFlags((x) => (e.target.checked ? [...x, f] : x.filter((y) => y !== f)))} />
                  {t(`flag.${f}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={submit}>{t('submit')}</button>
            <button type="button" className="btn btn-ghost" onClick={close}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
