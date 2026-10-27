'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { COACH } from '@coach/core/shared';
import { isoToday } from '@/lib/format';
import { IconCamera, IconCheck, IconFlip } from '../icons';
import { prepare } from '../PhotoUploader';

type Angle = 'front' | 'side' | 'back';
const ANGLES: Angle[] = ['front', 'side', 'back'];
const RATIO = 3 / 4; // width / height, the same frame as every stored photo

/**
 * Progress photo camera. The previous photo of the same angle is laid over the live view at low
 * opacity ("ghost") so pose, distance and framing match. The selfie view is mirrored, and so is
 * the ghost, so they line up; the saved photo is never mirrored. Gallery upload is the fallback.
 */
export function PhotoCamera({ ghosts, doneToday }: { ghosts: Partial<Record<Angle, string>>; doneToday: Angle[] }) {
  const t = useTranslations('progress.camera');
  const tp = useTranslations('photos');
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [angle, setAngle] = useState<Angle>(ANGLES.find((a) => !doneToday.includes(a)) ?? 'front');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ghostOn, setGhostOn] = useState(true);
  const [timer, setTimer] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Angle[]>(doneToday);
  const [camError, setCamError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    setCamError(false);
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((x) => x.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      })
      .catch(() => setCamError(true));
    if (!navigator.mediaDevices) setCamError(true);
    return () => { stopped = true; stream?.getTracks().forEach((x) => x.stop()); };
  }, [facing, shot]);

  useEffect(() => {
    if (count == null) return;
    if (count === 0) { setCount(null); capture(); return; }
    const id = setTimeout(() => setCount((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture reads the live video element
  }, [count]);

  /** Crop the frame to 3:4 exactly as the preview shows it (object-cover), at most maxLongSidePx tall. */
  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    const sw = Math.min(vw, vh * RATIO), sh = sw / RATIO;
    const h = Math.min(COACH.photos.maxLongSidePx, sh), w = Math.round(h * RATIO);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(h);
    c.getContext('2d')!.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((b) => b && setShot({ blob: b, url: URL.createObjectURL(b) }), 'image/jpeg', COACH.photos.jpegQuality);
  }

  async function save(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('file', blob, `${angle}.jpg`);
      body.set('angle', angle);
      body.set('date', isoToday());
      const r = await fetch('/api/photos', { method: 'POST', body });
      if (!r.ok) throw new Error(String(r.status));
      const nowDone = [...new Set([...done, angle])];
      setDone(nowDone);
      if (shot) URL.revokeObjectURL(shot.url);
      setShot(null);
      const next = ANGLES.find((a) => !nowDone.includes(a));
      if (next) setAngle(next);
      router.refresh();
    } catch {
      setError(tp('failed'));
    } finally {
      setBusy(false);
    }
  }

  const mirror = facing === 'user' ? '-scale-x-100' : '';
  const allDone = ANGLES.every((a) => done.includes(a));

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('title')} className="grid grid-cols-3 gap-2">
        {ANGLES.map((a) => (
          <button key={a} type="button" role="tab" aria-selected={a === angle} onClick={() => { setAngle(a); setShot(null); }}
            className={`chip ${a === angle ? 'border-accent bg-accent-soft text-accent-text' : ''}`}>
            {done.includes(a) && <IconCheck className="h-4 w-4 text-ok" />}{tp(a)}
          </button>
        ))}
      </div>

      <div className="relative mx-auto aspect-[3/4] w-[min(100%,42vh)] overflow-hidden rounded-2xl bg-black">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the capture
          <img src={shot.url} alt="" className="h-full w-full object-cover" />
        ) : camError ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-white/80">{t('noCamera')}</div>
        ) : (
          <>
            <video ref={video} playsInline muted className={`h-full w-full object-cover ${mirror}`} />
            {ghostOn && ghosts[angle] && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={ghosts[angle]} alt="" className={`pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35 ${mirror}`} />
            )}
            {!ghosts[angle] && (
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <span className="absolute inset-y-6 start-1/2 border-s border-dashed border-white/30" />
                <span className="absolute inset-x-6 bottom-[8%] border-t border-dashed border-white/30" />
              </div>
            )}
            {count != null && <div className="absolute inset-0 grid place-items-center bg-black/30 text-7xl font-extrabold text-white num" aria-live="assertive">{count}</div>}
          </>
        )}
      </div>

      {shot ? (
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => { URL.revokeObjectURL(shot.url); setShot(null); }} disabled={busy}>{t('retake')}</button>
          <button type="button" className="btn btn-primary flex-1" onClick={() => void save(shot.blob)} disabled={busy}>{busy ? tp('uploading') : t('use')}</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost px-2 text-sm" onClick={() => file.current?.click()}>{t('gallery')}</button>
          <button type="button" aria-label={t('capture')} disabled={camError || count != null}
            onClick={() => (timer ? setCount(10) : capture())}
            className="grid h-18 w-18 place-items-center rounded-full border-4 border-accent bg-accent/15 text-accent-text transition-transform active:scale-95 disabled:opacity-40">
            <IconCamera className="h-8 w-8" />
          </button>
          <div className="flex gap-1">
            <button type="button" aria-label={t('flip')} title={t('flip')} className="btn btn-ghost px-2" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
              <IconFlip className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {!shot && (
        <div className="flex flex-wrap gap-2">
          <label className="chip text-sm"><input type="checkbox" checked={timer} onChange={(e) => setTimer(e.target.checked)} />{t('timer')}</label>
          {ghosts[angle] && <label className="chip text-sm"><input type="checkbox" checked={ghostOn} onChange={(e) => setGhostOn(e.target.checked)} />{t('ghost')}</label>}
        </div>
      )}
      <input ref={file} type="file" accept="image/*" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setShot({ blob: await prepare(f), url: URL.createObjectURL(f) }); }} />

      {error && <p role="alert" className="note note-danger">{error}</p>}
      {allDone && <p role="status" className="note note-ok">{t('saved')}</p>}
      <p className="field-hint">{t('guide')} {tp('privacy')}</p>
    </div>
  );
}
