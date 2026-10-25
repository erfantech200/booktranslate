'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { estimateRun } from '@bookbridge/core/shared';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { startWorker } from '@/app/[locale]/actions';

const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.txt,.md,image/*,application/pdf,text/plain';
const MAX_FILES = 50;

function kindOf(f: File): 'image' | 'pdf' | 'text' | null {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (f.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
  if (f.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (f.type.startsWith('text/') || ['txt', 'md'].includes(ext)) return 'text';
  return null;
}

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';

/**
 * Uploads go straight from the browser to the private `sources` bucket under `<user>/<book>/<batch>/`
 * (storage RLS enforces the prefix). Then the batch is queued for the worker.
 */
export function Uploader({ bookId, userId, ocrModel, translateModel }: { bookId: string; userId: string; ocrModel: string; translateModel: string }) {
  const t = useTranslations('book');
  const locale = useLocale();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteSources, setDeleteSources] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => kindOf(f));
    setFiles((cur) => [...cur, ...ok].slice(0, MAX_FILES));
  };

  const images = files.filter((f) => kindOf(f) === 'image').length;
  const est = images ? estimateRun({ ocrModel, translateModel, ocrPages: images, sourceTokens: images * 450 }) : null;
  const num = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);
  const usd = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

  async function start() {
    setError(null);
    const sb = supabaseBrowser();
    try {
      const { data: last } = await sb.from('batches').select('seq').eq('book_id', bookId).order('seq', { ascending: false }).limit(1).maybeSingle();
      const { data: batch, error: be } = await sb.from('batches')
        .insert({ user_id: userId, book_id: bookId, seq: (last?.seq ?? 0) + 1, status: 'uploading', delete_sources_on_complete: deleteSources })
        .select('id').single();
      if (be) throw be;
      setProgress({ done: 0, total: files.length });
      let done = 0;
      const queue = files.map((f, i) => ({ f, i }));
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const { f, i } = item;
          const path = `${userId}/${bookId}/${batch.id}/${String(i).padStart(3, '0')}-${safeName(f.name)}`;
          const { error: ue } = await sb.storage.from('sources').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: true });
          if (ue) throw ue;
          const { error: fe } = await sb.from('source_files').insert({
            user_id: userId, book_id: bookId, batch_id: batch.id, storage_path: path, original_name: f.name,
            mime: f.type || null, size_bytes: f.size, kind: kindOf(f), upload_index: i,
            last_modified: f.lastModified ? new Date(f.lastModified).toISOString() : null,
          });
          if (fe) throw fe;
          setProgress({ done: ++done, total: files.length });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      await sb.from('batches').update({ status: 'queued' }).eq('id', batch.id);
      const { error: je } = await sb.from('jobs').insert({
        user_id: userId, book_id: bookId, type: 'ingest_batch', payload: { batchId: batch.id }, dedupe_key: `ingest_batch:${batch.id}`,
      });
      if (je && je.code !== '23505') throw je;
      await startWorker();
      setFiles([]);
      setProgress(null);
      window.dispatchEvent(new Event('bookbridge:refresh'));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setProgress(null);
    }
  }

  const busy = !!progress;
  return (
    <section className="sheet p-5" aria-labelledby="upload-h">
      <h2 id="upload-h" className="sheet-title mb-4">{t('upload')}</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          drag ? 'border-lajvard bg-lajvard-soft' : 'border-lajvard/25 bg-paper/60'}`}
      >
        <svg viewBox="0 0 48 48" className="h-11 w-11 text-lajvard" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 12h16a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" />
          <path d="M16 6h18a4 4 0 0 1 4 4v24" opacity=".5" /><path d="M12 22h12M12 28h12M12 34h7" />
        </svg>
        <p className="font-medium">{t('dropHere')}</p>
        <button type="button" className="btn-line" onClick={() => input.current?.click()} disabled={busy}>{t('choose')}</button>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <p className="text-[0.8125rem] text-muted">{t('formats')}</p>
      </div>

      {files.length > 0 && (
        <div className="mt-5 space-y-4">
          <p className="text-sm font-medium">{t('filesChosen', { n: num(files.length) })}</p>
          <ul className="flex max-h-36 flex-wrap gap-1.5 overflow-auto">
            {files.map((f, i) => (
              <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-md bg-lajvard-soft py-0.5 ps-2 pe-1 text-xs text-lajvard">
                <span dir="ltr" className="truncate">{f.name}</span>
                {!busy && (
                  <button type="button" className="rounded p-0.5 hover:bg-lajvard/10" aria-label={`${t('remove')} ${f.name}`}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {est && <p className="text-sm text-muted">{t('estimate', { fast: usd(est.totalFastUsd), pages: num(images) })}</p>}
          <label className="check text-sm">
            <input type="checkbox" checked={deleteSources} onChange={(e) => setDeleteSources(e.target.checked)} disabled={busy} />
            {t('deleteSources')}
          </label>
          {progress && (
            <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
              <div className="h-full rounded-full bg-zafaran transition-[width]" style={{ width: `${(100 * progress.done) / progress.total}%` }} />
            </div>
          )}
          <button className="btn w-full sm:w-auto" disabled={busy} onClick={start}>
            {progress ? t('uploading', { done: num(progress.done), total: num(progress.total) }) : t('start')}
          </button>
        </div>
      )}
      {error && <p role="alert" className="note note-alert mt-4">{error}</p>}
    </section>
  );
}
