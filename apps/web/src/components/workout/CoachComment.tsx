'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Asks the server for the finish-screen comment once; shows it when ready. */
export function CoachComment({ sessionId, initial, status }: { sessionId: string; initial: string | null; status: string }) {
  const t = useTranslations('session');
  const [comment, setComment] = useState(initial);
  const [state, setState] = useState(status);
  useEffect(() => {
    if (status !== 'pending') return;
    let live = true;
    fetch('/api/workout/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })
      .then((r) => r.json())
      .then((j: { status: string; comment?: string }) => { if (live) { setState(j.status); setComment(j.comment ?? null); } })
      .catch(() => live && setState('failed'));
    return () => { live = false; };
  }, [sessionId, status]);
  if (state === 'none') return null;
  return (
    <section className="card" aria-labelledby="coach-h" aria-busy={state === 'pending'}>
      <h2 id="coach-h" className="card-title">{t('coach')}</h2>
      {state === 'ok' && comment ? <p className="mt-2 text-[1.0625rem] leading-8">{comment}</p>
        : state === 'pending' ? <p className="mt-2 animate-pulse text-muted">{t('coachPending')}</p>
        : <p className="mt-2 text-sm text-muted">{t('coachFailed')}</p>}
    </section>
  );
}
