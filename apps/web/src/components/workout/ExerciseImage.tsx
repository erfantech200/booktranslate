'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { flagExerciseImage } from '@/lib/imageActions';

/**
 * Exercise illustration (spec §7): drawn on the first view, then cached. A visual aid only: the
 * written cues below come first. "Image is wrong" hides it; "regenerate" draws a new one.
 */
export function ExerciseImage({ slug, name, status, url }: { slug: string; name: string; status: 'pending' | 'ok' | 'flagged'; url: string | null }) {
  const t = useTranslations('library');
  const [src, setSrc] = useState(url);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'flagged' | 'error'>(status === 'ok' && url ? 'ok' : status === 'flagged' ? 'flagged' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function load(regenerate: boolean) {
    setState('loading');
    setError(null);
    try {
      const r = await fetch('/api/exercise-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, regenerate }) });
      const j = await r.json();
      if (j.status === 'ok' && j.url) { setSrc(j.url); setState('ok'); }
      else if (j.status === 'flagged') setState('flagged');
      else { setState('error'); setError(j.error ?? 'failed'); }
    } catch {
      setState('error');
      setError('failed');
    }
  }
  // Lazily on first view (spec §7).
  useEffect(() => { if (status === 'pending') void load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card p-3" aria-label={t('image')}>
      {state === 'ok' && src ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={src} alt={t('imageAlt', { name })} className="aspect-[3/2] w-full rounded-xl bg-surface-2 object-contain" />
      ) : (
        <div className="grid aspect-[3/2] w-full place-items-center rounded-xl bg-surface-2 p-4 text-center text-sm text-muted" aria-busy={state === 'loading'}>
          {state === 'loading' ? <span className="animate-pulse">{t('imageDrawing')}</span>
            : state === 'flagged' ? t('imageHidden')
              : state === 'error' ? t(error === 'budget' ? 'imageBudget' : error === 'limit' ? 'imageLimit' : 'imageFailed')
                : t('imageNone')}
        </div>
      )}
      <p className="field-hint">{t('imageNote')}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {state === 'ok' && (
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-sm" disabled={pending}
            onClick={() => start(async () => { await flagExerciseImage(slug); setState('flagged'); })}>{t('imageWrong')}</button>
        )}
        {state !== 'loading' && (
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-sm" onClick={() => void load(true)}>
            {state === 'ok' || state === 'flagged' ? t('imageRegenerate') : t('imageTry')}
          </button>
        )}
      </div>
    </section>
  );
}
