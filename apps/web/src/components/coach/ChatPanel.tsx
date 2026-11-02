'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { COACH } from '@coach/core/shared';
import { fmtNum, type Digits } from '@/lib/format';
import { ProposalCard, type ProposalView } from './ProposalCard';

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; created_at: string }

/** Coach chat (spec §12): persistent history, Persian; proposals render as cards under the reply. */
export function ChatPanel({ initial, proposals, names, meals, digits }: {
  initial: ChatMessage[];
  proposals: (ProposalView & { messageId: string | null })[];
  names: Record<string, string>;
  meals: Record<string, string>;
  digits: Digits;
}) {
  const t = useTranslations('coach');
  const [messages, setMessages] = useState(initial);
  const [cards, setCards] = useState(proposals);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);

  async function send(body: string) {
    const msg = body.trim();
    if (!msg || busy) return;
    if (msg.length > COACH.coach.maxMessageChars) { setError(t('tooLong', { n: COACH.coach.maxMessageChars })); return; }
    setBusy(true);
    setError(null);
    setNote(null);
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    setText('');
    try {
      const r = await fetch('/api/coach/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: msg }) });
      const j = await r.json();
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...(j.user ? [j.user] : [temp]), ...(j.reply ? [j.reply] : [])]);
      if (j.adjustments?.length) setCards((c) => [...c, ...j.adjustments]);
      if (j.dropped) setNote(t('dropped', { n: j.dropped, count: fmtNum(j.dropped, digits) }));
      if (j.error) setError(j.error === 'budget' ? t('budget') : j.error === 'too_long' ? t('tooLong', { n: COACH.coach.maxMessageChars }) : t('failed'));
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('title')} className="space-y-3">
      {messages.length === 0 && (
        <div className="card">
          <p className="text-muted">{t('empty')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(t.raw('examples') as string[]).map((x) => (
              <button key={x} type="button" className="chip text-sm" onClick={() => void send(x)} disabled={busy}>{x}</button>
            ))}
          </div>
        </div>
      )}
      <ol className="space-y-3" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[88%] space-y-2 ${m.role === 'user' ? '' : 'w-full'}`}>
              <div className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 leading-7 ${m.role === 'user' ? 'rounded-ss-md bg-accent text-accent-fg' : 'rounded-se-md bg-surface-2'}`} dir="auto">
                <span className="sr-only">{m.role === 'user' ? t('you') : t('coach')}: </span>{m.content}
              </div>
              {cards.filter((c) => c.messageId === m.id).map((c) => <ProposalCard key={c.id} p={c} names={names} meals={meals} digits={digits} />)}
            </div>
          </li>
        ))}
        {busy && <li className="flex justify-end"><p className="animate-pulse rounded-2xl bg-surface-2 px-4 py-2.5 text-muted">{t('sending')}</p></li>}
      </ol>
      {note && <p className="note note-info text-sm">{note}</p>}
      {error && <p role="alert" className="note note-danger text-sm">{error}</p>}
      <div ref={end} />
      <form className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lg"
        onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label className="sr-only" htmlFor="coach-msg">{t('placeholder')}</label>
        <textarea id="coach-msg" className="input min-h-11 flex-1 resize-none border-0 bg-transparent" rows={1} value={text} maxLength={COACH.coach.maxMessageChars}
          placeholder={t('placeholder')} dir="auto" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} />
        <button className="btn btn-primary min-h-11 shrink-0" disabled={busy || !text.trim()}>{t('send')}</button>
      </form>
    </section>
  );
}
