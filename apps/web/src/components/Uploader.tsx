'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { estimateRun } from '@bookbridge/core/shared';
import { supabaseBrowser } from '@/lib/supabase/browser';

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
      setFiles([]);
      setProgress(null);
      window.dispatchEvent(new Event('bookbridge:refresh'));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setProgress(null);
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{t('upload')}</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm ${drag ? 'border-accent bg-accent-soft' : 'border-slate-300'}`}
      >
        <p>{t('dropHere')}</p>
        <button type="button" className="btn-ghost" onClick={() => input.current?.click()}>{t('choose')}</button>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <p className="text-xs text-slate-500">{t('formats')}</p>
      </div>
      {files.length > 0 && (
        <>
          <ul className="flex max-h-32 flex-wrap gap-1 overflow-auto text-xs">
            {files.map((f, i) => (
              <li key={i} className="chip chip-idle">
                <span dir="ltr">{f.name}</span>
                {!progress && <button aria-label="remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>}
              </li>
            ))}
          </ul>
          {est && <p className="text-sm text-slate-600">{t('estimate', { fast: usd(est.totalFastUsd), pages: images })}</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deleteSources} onChange={(e) => setDeleteSources(e.target.checked)} />
            {t('deleteSources')}
          </label>
          <button className="btn" disabled={!!progress} onClick={start}>
            {progress ? t('uploading', { done: progress.done, total: progress.total }) : t('start')}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
