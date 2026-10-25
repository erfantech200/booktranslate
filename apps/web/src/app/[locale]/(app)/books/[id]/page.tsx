import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { stageModel } from '@bookbridge/core/shared';
import { Link } from '@/i18n/navigation';
import { LiveBook } from '@/components/LiveBook';
import { Uploader } from '@/components/Uploader';
import { bookStatus } from '@/lib/data';
import { currentUser } from '@/lib/supabase/server';
import { createExport, resumePaused } from '../../../actions';

export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, user, status] = await Promise.all([getTranslations('book'), currentUser(), bookStatus(id)]);
  if (!status || !user) notFound();
  const settings = status.book.settings as { quality?: 'standard' | 'premium'; pageSize?: string };

  const exportForm = (
    <form action={createExport.bind(null, id)} className="flex flex-wrap items-end gap-3 text-sm">
      <label>
        <span className="label">{t('pageSize')}</span>
        <select name="pageSize" defaultValue={settings.pageSize ?? 'A5'} className="input">
          <option value="A5">A5</option>
          <option value="A4">A4</option>
        </select>
      </label>
      <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="grayscale" /> {t('grayscale')}</label>
      <button name="format" value="pdf" className="btn">{t('exportPdf')}</button>
      <button name="format" value="epub" className="btn">{t('exportEpub')}</button>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{status.book.title}</h1>
          {status.book.author && <p className="text-slate-600">{status.book.author}</p>}
        </div>
        <Link href={`/books/${id}/review`} className="btn-ghost">{t('review')}</Link>
        <Link href={`/books/${id}/glossary`} className="btn-ghost">{t('glossary')}</Link>
        {status.pausedJobs > 0 && (
          <form action={resumePaused.bind(null, id)}><button className="btn">{t('resume')}</button></form>
        )}
      </div>
      <Uploader bookId={id} userId={user.id}
        ocrModel={stageModel('ocr').model} translateModel={stageModel('translate', settings.quality ?? 'standard').model} />
      <LiveBook initial={status} exportForm={exportForm} />
    </div>
  );
}
