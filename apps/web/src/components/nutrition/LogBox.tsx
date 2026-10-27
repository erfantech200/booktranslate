'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { latinDigits } from '@/lib/digits';
import { fmtNum, isoToday, type Digits } from '@/lib/format';
import { parseFoodPhoto, parseFoodText, saveFoodLog, type ParsedItem, type ParseResult } from '@/lib/nutritionActions';

/** Re-encode a photo in the browser: smaller upload, no EXIF (location, device). */
async function shrink(file: File, max = 1024): Promise<string> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

type Row = ParsedItem & { name: string };

/**
 * Fast logging (spec §9): type what you ate or take a photo; the model maps it to foods and grams,
 * the app computes the macros, and nothing is saved until confirmed.
 */
export function LogBox({ digits }: { digits: Digits }) {
  const t = useTranslations('nutrition');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<'text' | 'photo'>('text');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const nf = (n: number) => fmtNum(Math.round(n), digits);

  const show = (r: ParseResult, src: 'text' | 'photo') => {
    if (!r.ok) { setError(r.error === 'empty' ? t('logEmpty') : t('logFailed')); return; }
    setSource(src);
    setNote(r.note);
    setRows(r.items.map((i) => ({ ...i, name: i.foodId ? r.names[i.foodId] ?? i.label : i.newFood!.name_fa })));
  };
  const scaled = (r: Row, grams: number) => {
    const k = grams / Math.max(1, r.grams);
    return { ...r, grams, macros: { kcal: r.macros.kcal * k, protein: r.macros.protein * k, carbs: r.macros.carbs * k, fat: r.macros.fat * k, fiber: r.macros.fiber * k } };
  };
  const total = (rows ?? []).reduce((a, r) => ({ kcal: a.kcal + r.macros.kcal, protein: a.protein + r.macros.protein }), { kcal: 0, protein: 0 });

  return (
    <section className="card" aria-labelledby="log-h">
      <h2 id="log-h" className="card-title">{t('logTitle')}</h2>
      {!rows ? (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => show(await parseFoodText(text), 'text')); }}>
          <label className="sr-only" htmlFor="log-text">{t('logTitle')}</label>
          <textarea id="log-text" className="input min-h-20" placeholder={t('logPlaceholder')} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary flex-1" disabled={busy || !text.trim()}>{busy ? t('logParsing') : t('logSubmit')}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => file.current?.click()}>{t('logPhoto')}</button>
            <input ref={file} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setError(null);
                start(async () => show(await parseFoodPhoto(await shrink(f)), 'photo'));
              }} />
          </div>
          {error && <p role="alert" className="note note-danger mt-3">{error}</p>}
        </form>
      ) : (
        <div className="mt-3">
          <p className="font-bold">{t('confirmTitle')}</p>
          {source === 'photo' && <p className="note note-warn mt-2 text-sm">{t('photoEstimate')}</p>}
          {note && source !== 'photo' && <p className="mt-1 text-sm text-muted">{note}</p>}
          <ul className="mt-3 divide-y divide-line">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}{r.estimated && <span className="ms-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] text-accent-text">{t('estimate')}</span>}</p>
                  <p className="num text-xs text-muted">{r.newFood ? `${t('newFood')} · ` : ''}{nf(r.macros.kcal)} {t('kcalUnit')} · {nf(r.macros.protein)} {t('g')} {t('protein')}</p>
                </div>
                <label className="flex items-center gap-1">
                  <span className="sr-only">{r.name}</span>
                  <input inputMode="numeric" dir="ltr" className="input num min-h-10 w-20 px-2 text-center" value={fmtNum(r.grams, digits, { useGrouping: false })}
                    onChange={(e) => { const g = Number(latinDigits(e.target.value)); if (Number.isFinite(g) && g >= 0 && g <= 3000) setRows((xs) => xs!.map((x, k) => (k === i ? scaled(x, g) : x))); }} />
                  <span className="text-xs text-muted">{t('g')}</span>
                </label>
                <button type="button" className="btn btn-ghost min-h-10 px-2" aria-label={t('remove')} onClick={() => setRows((xs) => xs!.filter((_, k) => k !== i))}>✕</button>
              </li>
            ))}
          </ul>
          <p className="num mt-2 text-sm font-bold">{t('total')}: {nf(total.kcal)} {t('kcalUnit')} · {nf(total.protein)} {t('g')} {t('protein')}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy || rows.length === 0 || rows.some((r) => r.grams < 1)}
              onClick={() => start(async () => {
                const r = await saveFoodLog({
                  date: isoToday(), source,
                  items: rows.map((x) => ({ foodId: x.foodId, newFood: x.newFood, grams: x.grams, label: x.label, estimated: x.estimated })),
                });
                if (r.ok) { setRows(null); setText(''); setError(null); } else setError(t('saveFailed'));
              })}>{t('confirmSave')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setRows(null); setError(null); }}>{t('confirmCancel')}</button>
          </div>
          {error && <p role="alert" className="note note-danger mt-3">{error}</p>}
        </div>
      )}
    </section>
  );
}
