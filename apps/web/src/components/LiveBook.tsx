'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BookStatus } from '@/lib/data';

const CHIP: Record<string, string> = {
  uploaded: 'chip-idle', normalizing: 'chip-busy', queued: 'chip-idle', extracting: 'chip-busy', extracted: 'chip-busy',
  translating: 'chip-busy', translated: 'chip-ok', needs_review: 'chip-warn', skipped: 'chip-idle', error: 'chip-err',
  uploading: 'chip-busy', processing: 'chip-busy', done: 'chip-ok', paused: 'chip-warn', rendering: 'chip-busy',
};

const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/**
 * Live per-page status, warnings, exports and cost. Polls the status API every 3 s while
 * anything is running (all values come from the database, nothing is simulated).
 */
export function LiveBook({ initial, exportForm }: { initial: BookStatus; exportForm: React.ReactNode }) {
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

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">{t('cost')}</div>
          <div className="text-xl font-semibold" dir="ltr">{usd(s.cost.cost_usd)}</div>
        </div>
        <div className="text-xs text-slate-500" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
          {t('costSplit', { ocr: usd(s.cost.extract_cost_usd), tr: usd(s.cost.translate_cost_usd), gl: usd(s.cost.glossary_cost_usd) })}
        </div>
      </section>

      {s.pausedJobs > 0 && (
        <p className="rounded-lg bg-orange-50 p-3 text-sm text-orange-800">{t('paused')}</p>
      )}

      {s.batches.length === 0 && <p className="text-slate-500">{t('noPages')}</p>}
      {[...s.batches].reverse().map((b) => {
        const pages = s.pages.filter((p) => p.batch_id === b.id);
        const warnings = [...(b.warnings ?? []), ...pages.flatMap((p) => (pageWarnings.get(p.id) ?? []).map((w: any) => ({ ...w, page: p })))];
        const done = pages.filter((p) => p.status === 'translated').length;
        return (
          <section key={b.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{t('batch', { n: num(b.seq) })}</h3>
              <span className={`chip ${CHIP[b.status] ?? 'chip-idle'}`}>{ts(b.status as any)}</span>
              {b.stage && <span className="text-xs text-slate-500">{tst(b.stage as any)}</span>}
              <span className="ms-auto text-xs text-slate-500">{num(done)} / {num(pages.length)}</span>
            </div>
            {b.error && <p className="text-sm text-red-600">{b.error}</p>}
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {pages.map((p) => {
                const warn = (pageWarnings.get(p.id) ?? []).length > 0;
                return (
                  <li key={p.id} className={`overflow-hidden rounded-lg border ${warn ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-200'}`}>
                    <div className="aspect-[3/4] bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      {p.thumb && <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <div className="space-y-1 p-1.5 text-[11px]">
                      <div className="text-slate-600">{p.printed_page_number != null ? t('page', { n: num(p.printed_page_number) }) : t('unnumbered')}</div>
                      <span className={`chip ${CHIP[p.status] ?? 'chip-idle'}`}>{ts(p.status as any)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {warnings.length > 0 && (
              <details open className="rounded-lg bg-orange-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-orange-900">{t('warnings')} ({num(warnings.length)})</summary>
                <ul className="mt-2 space-y-1 text-orange-900">
                  {warnings.map((w: any, i: number) => (
                    <li key={i}>
                      {w.page && <strong>{w.page.printed_page_number != null ? t('page', { n: num(w.page.printed_page_number) }) : (w.page.original_name ?? '')}: </strong>}
                      {w.message}
                      {w.page && ['blur', 'glare', 'cut_off', 'low_quality', 'needs_review'].includes(w.code) && <span className="text-orange-700"> — {t('retake')}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}

      <section className="card space-y-3">
        <h3 className="font-semibold">{t('export')}</h3>
        {exportForm}
        {s.exports.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {s.exports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium uppercase" dir="ltr">{e.format}</span>
                {e.options?.pageSize && <span className="text-slate-500" dir="ltr">{e.options.pageSize}</span>}
                <span className={`chip ${CHIP[e.status] ?? 'chip-idle'}`}>{ts(e.status as any)}</span>
                {e.page_count != null && <span className="text-xs text-slate-500">{num(e.page_count)} pp</span>}
                {e.error && <span className="text-xs text-red-600">{e.error}</span>}
                {e.status === 'done' && <a className="btn-ghost ms-auto" href={`/api/exports/${e.id}/download`}>{t('download')}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
