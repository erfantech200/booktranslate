'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { substituteOptions, swapExercise } from '@/lib/workoutActions';
import { Sheet } from './Sheet';
import type { SwapResult } from './types';

/** Swap the current exercise for an eligible substitute, for today or the rest of the block. */
export function SwapSheet({ open, onClose, sessionId, exIdx, slug, name, onSwapped }: {
  open: boolean; onClose: () => void; sessionId: string; exIdx: number; slug: string; name: string;
  onSwapped: (x: SwapResult) => void;
}) {
  const t = useTranslations('gym');
  const [options, setOptions] = useState<{ slug: string; nameFa: string }[] | null>(null);
  const [scope, setScope] = useState<'today' | 'block'>('today');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    setOptions(null);
    setError(false);
    substituteOptions(slug).then(setOptions, () => { setOptions([]); setError(true); });
  }, [open, slug]);

  async function pick(s: string) {
    setBusy(s);
    setError(false);
    try {
      onSwapped(await swapExercise(sessionId, exIdx, s, scope));
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('swapTitle', { name })}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['today', 'block'] as const).map((k) => (
          <label key={k} className="chip"><input type="radio" name="swap-scope" checked={scope === k} onChange={() => setScope(k)} />{t(k === 'today' ? 'swapToday' : 'swapBlock')}</label>
        ))}
      </div>
      {options === null ? <p className="py-6 text-center text-muted">…</p>
        : options.length === 0 && !error ? <p className="note note-info">{t('swapNone')}</p>
        : (
          <ul className="divide-y divide-line">
            {options.map((o) => (
              <li key={o.slug}>
                <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-start disabled:opacity-50"
                  disabled={busy !== null} onClick={() => pick(o.slug)}>
                  <span>{o.nameFa}</span>
                  <span className="text-sm text-accent-text">{busy === o.slug ? '…' : t('swap')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {error && <p role="alert" className="note note-danger mt-3">{t('swapFailed')}</p>}
    </Sheet>
  );
}
