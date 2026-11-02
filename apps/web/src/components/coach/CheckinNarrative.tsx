'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Narrative { went_well: string[]; improve: string[]; focus: string[] }

/** Asks the server for the check-in narrative once; shows it when ready. The numbers are already on screen. */
export function CheckinNarrative({ checkinId, initial, status }: { checkinId: string; initial: Narrative | null; status: string }) {
  const t = useTranslations('checkin');
  const [n, setN] = useState(initial);
  const [state, setState] = useState(status);
  useEffect(() => {
    if (status !== 'pending') return;
    let live = true;
    fetch('/api/checkin/narrative', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkinId }) })
      .then((r) => r.json())
      .then((j: { status: string; narrative?: Narrative }) => { if (live) { setState(j.status); setN(j.narrative ?? null); } })
      .catch(() => live && setState('failed'));
    return () => { live = false; };
  }, [checkinId, status]);

  const list = (title: string, items: string[]) => items.length > 0 && (
    <div>
      <h3 className="text-sm font-bold text-muted">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 ps-5 leading-7">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
  return (
    <section className="card" aria-labelledby="narr-h" aria-busy={state === 'pending'}>
      <h2 id="narr-h" className="card-title">{t('narrative')}</h2>
      {state === 'ok' && n ? (
        <div className="mt-3 space-y-3">
          {list(t('wentWell'), n.went_well)}
          {list(t('improve'), n.improve)}
          {list(t('focus'), n.focus)}
        </div>
      ) : state === 'pending' ? <p className="mt-2 animate-pulse text-muted">{t('narrativePending')}</p>
        : <p className="mt-2 text-sm text-muted">{t('narrativeFailed')}</p>}
    </section>
  );
}
