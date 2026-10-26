'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fmtNum, type Digits } from '@/lib/format';

let audio: AudioContext | null = null;
/** Called from a tap so iOS lets us play the end-of-rest beep later. */
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no audio */ }
}
function beep() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, f] of [880, 1175].entries()) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 0.17);
  }
}

const mmss = (s: number, digits: Digits) => `${fmtNum(Math.floor(s / 60), digits)}:${fmtNum(s % 60, digits, { minimumIntegerDigits: 2 })}`;

/** Rest countdown docked at the bottom: the bar drains as rest runs out; beeps, buzzes and notifies at zero. */
export { mmss };

export function RestTimer({ endsAt, total, nextName, digits, onAdd, onSkip, onDone }: {
  endsAt: number; total: number; nextName: string; digits: Digits; onAdd: () => void; onSkip: () => void; onDone: () => void;
}) {
  const t = useTranslations('gym');
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [endsAt]);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    navigator.vibrate?.([220, 120, 220]);
    beep();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(t('notifyTitle'), { body: t('notifyBody', { name: nextName }), tag: 'rest', silent: false }); } catch { /* some browsers need a service worker */ }
    }
    const done = setTimeout(onDone, 2500);
    return () => clearTimeout(done);
  }, [left, nextName, onDone, t]);
  const frac = total > 0 ? Math.min(1, (endsAt - now) / (total * 1000)) : 0;
  return (
    <div role="timer" aria-live="off" aria-label={t('rest')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
      <div className="h-1.5 bg-surface-2"><div className="h-full bg-accent transition-[width] duration-300 ease-linear" style={{ width: `${frac * 100}%` }} /></div>
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{left > 0 ? t('rest') : t('restDone')}</p>
          <p className={`num text-4xl font-extrabold leading-tight ${left === 0 ? 'text-ok' : ''}`} dir="ltr" style={{ textAlign: 'right' }}>{mmss(left, digits)}</p>
          <p className="truncate text-xs text-muted">{t('notifyBody', { name: nextName })}</p>
        </div>
        <button type="button" className="btn btn-secondary px-4" onClick={onAdd}>{t('restAdd', { n: fmtNum(30, digits) })}</button>
        <button type="button" className="btn btn-ghost" onClick={onSkip}>{t('restSkip')}</button>
      </div>
    </div>
  );
}
