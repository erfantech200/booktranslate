'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

type PdfDoc = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>['promise']>;

/**
 * Draws the exported PDF page by page with pdf.js (works on phones, unlike an embedded PDF).
 * Pages are rendered when they scroll near the viewport.
 */
export function PdfPreview({ url }: { url: string }) {
  const t = useTranslations('preview');
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const loading = pdfjs.getDocument({ url });
      task = loading;
      const loaded = await loading.promise;
      const s: { w: number; h: number }[] = [];
      for (let i = 1; i <= loaded.numPages; i++) {
        const v = (await loaded.getPage(i)).getViewport({ scale: 1 });
        s.push({ w: v.width, h: v.height });
      }
      if (cancelled) return;
      setSizes(s);
      setDoc(loaded);
    })().catch((e) => { console.error(e); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [url]);

  if (failed) return <p role="alert" className="note note-alert">{t('failed')}</p>;
  if (!doc) return <p role="status" className="text-muted">{t('loading')}</p>;
  return (
    <ol className="mx-auto max-w-[44rem] space-y-6">
      {sizes.map((s, i) => <PdfPage key={i} doc={doc} n={i + 1} total={sizes.length} size={s} />)}
    </ol>
  );
}

function PdfPage({ doc, n, total, size }: { doc: PdfDoc; n: number; total: number; size: { w: number; h: number } }) {
  const t = useTranslations('preview');
  const locale = useLocale();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry?.isIntersecting || task) return;
      io.disconnect();
      const page = await doc.getPage(n);
      const scale = (el.clientWidth / size.w) * Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = page.render({ canvas: el, viewport });
      task.promise.catch(() => {});
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => { io.disconnect(); task?.cancel(); };
  }, [doc, n, size.w]);

  const label = t('pageOf', { n: new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n), total: new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(total) });
  return (
    <li>
      {/* dir="ltr": a canvas inherits text direction, and pdf.js positions glyphs assuming LTR. */}
      <canvas ref={canvas} dir="ltr" role="img" aria-label={label} className="block w-full rounded-sm bg-surface shadow-[0_1px_0_var(--color-line),0_12px_28px_-16px_rgba(21,34,82,0.45)]"
        style={{ aspectRatio: `${size.w} / ${size.h}` }} />
      <p className="mt-2 text-center text-[0.8125rem] text-muted" aria-hidden="true">{label}</p>
    </li>
  );
}
