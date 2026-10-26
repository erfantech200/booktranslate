'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { COACH } from '@coach/core/shared';
import { IconCamera, IconCheck } from './icons';

type Angle = 'front' | 'side' | 'back';
const ANGLES: Angle[] = ['front', 'side', 'back'];

/** Downscale + re-encode in the browser: smaller upload, and the re-encode drops EXIF (GPS, device). */
async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, COACH.photos.maxLongSidePx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', COACH.photos.jpegQuality));
}

export function PhotoUploader({ date, existing }: { date: string; existing: { angle: Angle; url: string }[] }) {
  const t = useTranslations('photos');
  const [urls, setUrls] = useState<Record<string, string>>(Object.fromEntries(existing.map((p) => [p.angle, p.url])));
  const [busy, setBusy] = useState<Angle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(angle: Angle, file: File | undefined) {
    if (!file) return;
    setBusy(angle);
    setError(null);
    try {
      const body = new FormData();
      body.set('file', await prepare(file), `${angle}.jpg`);
      body.set('angle', angle);
      body.set('date', date);
      const r = await fetch('/api/photos', { method: 'POST', body });
      if (!r.ok) throw new Error(String(r.status));
      const { url } = await r.json();
      setUrls((u) => ({ ...u, [angle]: url }));
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {ANGLES.map((angle) => (
          <div key={angle}>
            <button type="button" onClick={() => inputs.current[angle]?.click()} disabled={busy !== null}
              className="relative flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-line bg-surface-2 text-muted transition-colors hover:border-accent hover:text-fg">
              {urls[angle]
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                ? <img src={urls[angle]} alt="" className="absolute inset-0 h-full w-full object-cover" />
                : <IconCamera className="h-8 w-8" />}
              {urls[angle] && <span className="absolute top-2 end-2 rounded-full bg-accent p-1 text-accent-fg"><IconCheck className="h-4 w-4" /></span>}
              {busy === angle && <span className="absolute inset-0 grid place-items-center bg-bg/70 text-sm text-fg">{t('uploading')}</span>}
            </button>
            <p className="mt-2 text-center text-sm font-medium">{t(angle)}</p>
            <input ref={(el) => { inputs.current[angle] = el; }} type="file" accept="image/*" className="hidden"
              onChange={(e) => { void upload(angle, e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="note note-danger mt-4">{error}</p>}
      <p className="field-hint mt-4">{t('privacy')}</p>
    </div>
  );
}
