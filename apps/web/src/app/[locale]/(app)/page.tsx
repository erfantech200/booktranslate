import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatUsd, listBooks } from '@/lib/data';
import { createBook } from '../actions';

export const dynamic = 'force-dynamic';

export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('library');
  const books = await listBooks();
  const fmt = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {books.length === 0 && <p className="text-slate-500">{t('empty')}</p>}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {books.map((b) => (
          <li key={b.id}>
            <Link href={`/books/${b.id}`} className="card block h-full p-0 transition hover:shadow-md">
              <div className="aspect-[3/4] overflow-hidden rounded-t-2xl bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                {b.cover && <img src={b.cover} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="space-y-1 p-3">
                <div className="line-clamp-2 font-semibold">{b.title}</div>
                {b.author && <div className="text-xs text-slate-500">{b.author}</div>}
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-accent" style={{ width: `${b.pages_total ? (100 * b.pages_translated) / b.pages_total : 0}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{t('pages', { done: fmt.format(b.pages_translated), total: fmt.format(b.pages_total) })}</span>
                  <span dir="ltr">{formatUsd(b.cost_usd)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <section className="card max-w-xl">
        <h2 className="mb-3 font-semibold">{t('newBook')}</h2>
        <form action={createBook.bind(null, locale)} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="label">{t('titleField')}</span><input name="title" required maxLength={300} className="input" /></label>
          <label><span className="label">{t('author')}</span><input name="author" maxLength={300} className="input" /></label>
          <label><span className="label">{t('translator')}</span><input name="translator_name" maxLength={300} className="input" /></label>
          <label><span className="label">{t('sourceLang')}</span>
            <select name="source_lang" defaultValue="en" className="input">
              {['en', 'fr', 'de', 'es', 'it', 'ru', 'tr', 'ar'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label><span className="label">{t('targetLang')}</span>
            <select name="target_lang" defaultValue="fa" className="input">
              {['fa', 'en', 'ar', 'de', 'fr', 'es', 'tr'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><button className="btn">{t('create')}</button></div>
        </form>
      </section>
    </div>
  );
}
