import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { stageModel } from '@bookbridge/core/shared';
import { Link } from '@/i18n/navigation';
import { BackLink } from '@/components/BackLink';
import { LiveBook } from '@/components/LiveBook';
import { Uploader } from '@/components/Uploader';
import { bookStatus } from '@/lib/data';
import { currentUser } from '@/lib/supabase/server';
import { createExport, resumePaused } from '../../../actions';

export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, nav, user, status] = await Promise.all([getTranslations('book'), getTranslations('nav'), currentUser(), bookStatus(id)]);
  if (!status || !user) notFound();
  const settings = status.book.settings as { quality?: 'standard' | 'premium'; pageSize?: string };

  const exportForm = (
    <form action={createExport.bind(null, id)} className="space-y-4">
      <fieldset>
        <legend className="field-label">{t('pageSize')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {['A5', 'A4'].map((size) => (
            <label key={size} className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-line py-2 text-sm has-[:checked]:border-lajvard has-[:checked]:bg-lajvard-soft has-[:checked]:text-lajvard has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zafaran" dir="ltr">
              <input type="radio" name="pageSize" value={size} defaultChecked={(settings.pageSize ?? 'A5') === size} className="sr-only" />
              {size}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check text-sm"><input type="checkbox" name="grayscale" /> {t('grayscale')}</label>
      <div className="grid grid-cols-2 gap-2">
        <button name="format" value="pdf" className="btn">{t('exportPdf')}</button>
        <button name="format" value="epub" className="btn-line">{t('exportEpub')}</button>
      </div>
    </form>
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <BackLink href="/">{nav('library')}</BackLink>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold leading-tight text-lajvard sm:text-4xl"><span dir="auto">{status.book.title}</span></h1>
            {status.book.author && <p className="mt-1 text-lg text-muted"><span dir="auto">{status.book.author}</span></p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/books/${id}/review`} className="btn-line">{t('review')}</Link>
            <Link href={`/books/${id}/glossary`} className="btn-line">{t('glossary')}</Link>
            {status.pausedJobs > 0 && (
              <form action={resumePaused.bind(null, id)}><button className="btn">{t('resume')}</button></form>
            )}
          </div>
        </div>
      </header>
      <LiveBook initial={status} exportForm={exportForm}
        uploader={<Uploader bookId={id} userId={user.id}
          ocrModel={stageModel('ocr').model} translateModel={stageModel('translate', settings.quality ?? 'standard').model} />} />
    </div>
  );
}
