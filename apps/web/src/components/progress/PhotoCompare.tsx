'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { fmtDate, fmtNum, type Digits } from '@/lib/format';

type Angle = 'front' | 'side' | 'back';
const ANGLES: Angle[] = ['front', 'side', 'back'];

/**
 * Two dates of progress photos: side by side, or one over the other with a slider. "Before" sits
 * on the start side (right, in RTL), as time reads in Persian. No body-fat or muscle estimates.
 */
export function PhotoCompare({ dates, a, b, urls, digits }: {
  dates: string[];
  a: string;
  b: string;
  urls: { a: Partial<Record<Angle, string>>; b: Partial<Record<Angle, string>> };
  digits: Digits;
}) {
  const t = useTranslations('progress.compare');
  const tp = useTranslations('photos');
  const router = useRouter();
  const [angle, setAngle] = useState<Angle>(ANGLES.find((x) => urls.a[x] && urls.b[x]) ?? 'front');
  const [mode, setMode] = useState<'side' | 'slider'>('side');
  const [pos, setPos] = useState(50);
  const go = (na: string, nb: string) => router.replace(`/progress/photos/compare?a=${na}&b=${nb}`);
  const apart = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const label = (iso: string) => fmtDate(iso, digits, { day: 'numeric', month: 'long', year: 'numeric' });
  const before = urls.a[angle], after = urls.b[angle];
  const missing = <div className="grid aspect-[3/4] w-full place-items-center rounded-xl bg-surface-2 p-3 text-center text-xs text-muted">{t('missing')}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {([['a', a, t('before')], ['b', b, t('after')]] as const).map(([k, v, l]) => (
          <label key={k} className="field">
            <span className="field-label">{l}</span>
            <select className="input" value={v} onChange={(e) => (k === 'a' ? go(e.target.value, b) : go(a, e.target.value))}>
              {dates.map((x) => <option key={x} value={x}>{label(x)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="num text-sm text-muted">{t('daysApart', { n: fmtNum(Math.abs(apart), digits) })}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {ANGLES.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={x === angle} onClick={() => setAngle(x)}
              className={`rounded-lg px-3 py-1.5 ${x === angle ? 'bg-surface font-bold text-fg shadow' : 'text-muted hover:text-fg'}`}>{tp(x)}</button>
          ))}
        </div>
        <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(['side', 'slider'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === mode} onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 ${m === mode ? 'bg-surface font-bold text-fg shadow' : 'text-muted hover:text-fg'}`}>{t(m === 'side' ? 'sideBySide' : 'slider')}</button>
          ))}
        </div>
      </div>

      {mode === 'side' || !before || !after ? (
        <div className="grid grid-cols-2 gap-2">
          {([[before, a, t('before')], [after, b, t('after')]] as const).map(([u, d, l], i) => (
            <figure key={i} className="m-0">
              {u
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                ? <img src={u} alt={`${l}: ${tp(angle)}، ${label(d)}`} className="aspect-[3/4] w-full rounded-xl bg-surface-2 object-cover" />
                : missing}
              <figcaption className="mt-1 text-center text-xs text-muted">{l} · {fmtDate(d, digits)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div>
          <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-2xl bg-surface-2" style={{ direction: 'ltr' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img src={after} alt={`${t('after')}: ${label(b)}`} className="absolute inset-0 h-full w-full object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img src={before} alt={`${t('before')}: ${label(a)}`} className="absolute inset-0 h-full w-full object-cover"
              style={{ clipPath: `inset(0 0 0 ${100 - pos}%)` }} />
            <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: `${100 - pos}%` }} />
            <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">{t('after')}</span>
            <span className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">{t('before')}</span>
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={t('sliderLabel')}
            className="mx-auto mt-3 block w-full max-w-md accent-[var(--accent)]" />
        </div>
      )}
    </div>
  );
}
