'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BookStatus } from '@/lib/data';

// Status family → tag colour. The tag text always names the state; colour only groups them.
const TAG: Record<string, string> = {
  uploaded: 'tag-idle', normalizing: 'tag-work', queued: 'tag-idle', extracting: 'tag-work', extracted: 'tag-work',
  translating: 'tag-work', translated: 'tag-done', needs_review: 'tag-alert', skipped: 'tag-idle', error: 'tag-alert',
  uploading: 'tag-work', processing: 'tag-work', done: 'tag-done', paused: 'tag-alert', rendering: 'tag-work',
};
// The same families as a thin edge under each page thumbnail.
const EDGE: Record<string, string> = { 'tag-idle': 'bg-line', 'tag-work': 'bg-zafaran', 'tag-done': 'bg-firoozeh', 'tag-alert': 'bg-anar' };

const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/**
 * Live per-page status, warnings, exports and cost. Polls the status API every 3 s while
 * anything is running (all values come from the database, nothing is simulated).
 */
export function LiveBook({ initial, uploader, exportForm }: { initial: BookStatus; uploader: React.ReactNode; exportForm: React.ReactNode }) {
  const t = useTranslations('book');
  const ts = useTranslations('status');
  const tst = useTranslations('stage');
  const locale = useLocale();
  const [s, setS] = useState(initial);
  const num = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/books/${initial.book.id}/status`, { cache: 'no-store' });
    if (r.ok) setS(await r.json());
  }, [initial.book.id]);

  useEffect(() => { setS(initial); }, [initial]);
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener('bookbridge:refresh', on);
    return () => window.removeEventListener('bookbridge:refresh', on);
  }, [refresh]);
  useEffect(() => {
    if (!s.active) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [s.active, refresh]);

  const pageWarnings = new Map(s.pages.map((p) => [p.id, p.warnings ?? []]));
  const pageLabel = (p: { printed_page_number: number | null }) =>
    p.printed_page_number != null ? t('page', { n: num(p.printed_page_number) }) : t('unnumbered');

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="min-w-0 space-y-8">
        {uploader}
        {s.pausedJobs > 0 && <p role="status" className="note note-work">{t('paused')}</p>}

        <section aria-labelledby="batches-h">
          <h2 id="batches-h" className="sheet-title mb-4">{t('pagesHeading')}</h2>
          {s.batches.length === 0 && <p className="text-muted">{t('noPages')}</p>}
          {/* Batches are a real sequence (uploads in order), so they are numbered on a timeline. */}
          <ol className="relative space-y-8 before:absolute before:inset-y-4 before:start-[15px] before:w-px before:bg-line">
            {[...s.batches].reverse().map((b) => {
              const pages = s.pages.filter((p) => p.batch_id === b.id);
              const warnings = [...(b.warnings ?? []), ...pages.flatMap((p) => (pageWarnings.get(p.id) ?? []).map((w: any) => ({ ...w, page: p })))];
              const done = pages.filter((p) => p.status === 'translated').length;
              return (
                <li key={b.id} className="relative ps-12">
                  <span className="absolute start-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-lajvard font-display text-sm font-bold text-paper ring-4 ring-paper">
                    {num(b.seq)}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                    <h3 className="font-medium">{t('batch', { n: num(b.seq) })}</h3>
                    <span className={`tag ${TAG[b.status] ?? 'tag-idle'}`}>{ts(b.status as any)}</span>
                    {b.stage && b.status === 'processing' && <span className="text-sm text-muted">{tst(b.stage as any)}</span>}
                    <span className="ms-auto text-sm text-muted">{t('pagesCount', { done: num(done), total: num(pages.length) })}</span>
                  </div>
                  {b.error && <p role="alert" className="note note-alert mt-3">{b.error}</p>}

                  <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 xl:grid-cols-7">
                    {pages.map((p) => {
                      const warn = (pageWarnings.get(p.id) ?? []).length > 0;
                      const tag = TAG[p.status] ?? 'tag-idle';
                      return (
                        <li key={p.id}>
                          <div className={`relative overflow-hidden rounded-md bg-lajvard-soft ${warn ? 'ring-2 ring-zafaran ring-offset-2 ring-offset-paper' : 'ring-1 ring-line'}`}>
                            <div className="aspect-[3/4]">
                              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                              {p.thumb && <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
                            </div>
                            <span className={`absolute inset-x-0 bottom-0 h-1 ${EDGE[tag]}`} aria-hidden="true" />
                          </div>
                          <p className="mt-1.5 truncate text-[0.8125rem] font-medium">{pageLabel(p)}</p>
                          <p className="truncate text-[0.75rem] text-muted">{ts(p.status as any)}</p>
                        </li>
                      );
                    })}
                  </ul>

                  {warnings.length > 0 && (
                    <details open className="note note-work mt-4">
                      <summary className="cursor-pointer font-medium">{t('warnings')} ({num(warnings.length)})</summary>
                      <ul className="mt-2 space-y-1.5">
                        {warnings.map((w: any, i: number) => (
                          <li key={i}>
                            {w.page && <strong className="font-medium">{w.page.printed_page_number != null ? pageLabel(w.page) : (w.page.original_name ?? '')}: </strong>}
                            {w.message}
                            {w.page && ['blur', 'glare', 'cut_off', 'low_quality', 'needs_review'].includes(w.code) && (
                              <span className="tag tag-alert ms-2 align-middle">{t('retake')}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-10">
        <section className="sheet p-5">
          <h2 className="text-sm text-muted">{t('cost')}</h2>
          <p className="mt-1 font-display text-3xl font-bold text-lajvard" dir="ltr">{usd(s.cost.cost_usd)}</p>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            {([['costOcr', s.cost.extract_cost_usd], ['costTranslate', s.cost.translate_cost_usd], ['costGlossary', s.cost.glossary_cost_usd]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted">{t(k)}</dt><dd dir="ltr">{usd(v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="sheet p-5">
          <h2 className="sheet-title mb-4">{t('export')}</h2>
          {exportForm}
          <h3 className="mt-6 mb-2 text-sm font-medium">{t('exports')}</h3>
          {s.exports.length === 0 ? <p className="text-sm text-muted">{t('noExports')}</p> : (
            <ul className="divide-y divide-line text-sm">
              {s.exports.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2.5">
                  <span className="font-medium" dir="ltr">{e.format.toUpperCase()}</span>
                  {e.options?.pageSize && <span className="text-muted" dir="ltr">{e.options.pageSize}</span>}
                  {e.status === 'done'
                    ? <a className="btn-quiet ms-auto" href={`/api/exports/${e.id}/download`}>{t('download')}</a>
                    : <span className={`tag ms-auto ${TAG[e.status] ?? 'tag-idle'}`}>{ts(e.status as any)}</span>}
                  {e.error && <span className="w-full text-xs text-anar">{e.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
