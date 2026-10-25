import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BackLink } from '@/components/BackLink';
import { EpubPreview } from '@/components/EpubPreview';
import { PdfPreview } from '@/components/PdfPreview';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Look at a finished export inside the app before downloading it. */
export default async function ExportPreviewPage({ params }: { params: Promise<{ locale: string; id: string; exportId: string }> }) {
  const { locale, id, exportId } = await params;
  setRequestLocale(locale);
  const sb = await supabaseServer();
  const [{ data: ex }, { data: book }] = await Promise.all([
    sb.from('exports').select('id, format, status, storage_path, options, page_count, size_bytes')
      .eq('id', exportId).eq('book_id', id).maybeSingle(),
    sb.from('books').select('title').eq('id', id).maybeSingle(),
  ]);
  if (!ex || !book || ex.status !== 'done' || !ex.storage_path) notFound();
  // Inline (no download name), short-lived: the viewer fetches it once on load.
  const { data: signed } = await sb.storage.from('exports').createSignedUrl(ex.storage_path, 600);
  if (!signed) notFound();
  const t = await getTranslations('preview');
  const num = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const mb = ex.size_bytes ? num.format(Math.max(0.1, Math.round(ex.size_bytes / 1e5) / 10)) : null;
  const pdf = ex.format === 'pdf';

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <BackLink href={`/books/${id}`}><span dir="auto">{book.title}</span></BackLink>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-lajvard sm:text-4xl">{t(pdf ? 'titlePdf' : 'titleEpub')}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 text-muted">
              {ex.options?.pageSize && pdf && <span dir="ltr">{ex.options.pageSize}</span>}
              {ex.page_count != null && <span>{t('pages', { n: num.format(ex.page_count) })}</span>}
              {mb && <span>{t('size', { mb })}</span>}
            </p>
          </div>
          <a href={`/api/exports/${ex.id}/download`} className="btn">{t('download')}</a>
        </div>
      </header>
      {pdf ? <PdfPreview url={signed.signedUrl} /> : <EpubPreview url={signed.signedUrl} />}
    </div>
  );
}
