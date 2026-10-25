import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BookCover } from '@/components/BookCover';
import { formatUsd, listBooks } from '@/lib/data';
import { createBook } from '../actions';

export const dynamic = 'force-dynamic';

const SOURCE_LANGS = ['en', 'fr', 'de', 'es', 'it', 'ru', 'tr', 'ar'];
const TARGET_LANGS = ['fa', 'en', 'ar', 'de', 'fr', 'es', 'tr'];

export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('library');
  const books = await listBooks();
  const fmt = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const langName = new Intl.DisplayNames([locale], { type: 'language' });
  const empty = books.length === 0;

  const form = (
    <section id="new-book" className="sheet scroll-mt-20 p-5">
      <h2 className="sheet-title">{t('newBook')}</h2>
      <p className="field-hint mb-4">{t('newBookHint')}</p>
      <form action={createBook.bind(null, locale)} className="space-y-4">
        <label className="field"><span className="field-label">{t('titleField')}</span><input name="title" required maxLength={300} className="input" /></label>
        <label className="field"><span className="field-label">{t('author')}</span><input name="author" maxLength={300} className="input" /></label>
        <label className="field"><span className="field-label">{t('translator')}</span><input name="translator_name" maxLength={300} className="input" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field"><span className="field-label">{t('sourceLang')}</span>
            <select name="source_lang" defaultValue="en" className="input">
              {SOURCE_LANGS.map((l) => <option key={l} value={l}>{langName.of(l)}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">{t('targetLang')}</span>
            <select name="target_lang" defaultValue="fa" className="input">
              {TARGET_LANGS.map((l) => <option key={l} value={l}>{langName.of(l)}</option>)}
            </select>
          </label>
        </div>
        <button className="btn w-full">{t('create')}</button>
      </form>
    </section>
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div>
        <header className="mb-8 flex items-baseline gap-3">
          <h1 className="font-display text-4xl font-bold text-lajvard">{t('title')}</h1>
          {!empty && <span className="text-muted">{t('count', { n: fmt.format(books.length) })}</span>}
          {!empty && <a href="#new-book" className="btn-line ms-auto self-center lg:hidden">{t('newBook')}</a>}
        </header>

        {empty ? (
          <div className="flex items-center gap-5 rounded-xl border border-dashed border-lajvard/30 p-6">
            <div className="w-20 shrink-0"><BookCover title="" author={null} cover={null} /></div>
            <div>
              <p className="font-medium">{t('empty')}</p>
              <p className="text-muted">{t('emptyHint')}</p>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
            {books.map((b) => {
              const pct = b.pages_total ? (100 * b.pages_translated) / b.pages_total : 0;
              return (
                <li key={b.id}>
                  <Link href={`/books/${b.id}`} className="group block rounded-md focus-visible:outline-offset-4">
                    <BookCover title={b.title} author={b.author} cover={b.cover} />
                    <h2 className="mt-3 line-clamp-2 font-medium leading-6 group-hover:text-lajvard"><span dir="auto">{b.title}</span></h2>
                    {b.author && <p className="text-sm text-muted"><span dir="auto">{b.author}</span></p>}
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-firoozeh" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 flex justify-between gap-2 text-[0.8125rem] text-muted">
                      <span>{t('pages', { done: fmt.format(b.pages_translated), total: fmt.format(b.pages_total) })}</span>
                      <span dir="ltr">{formatUsd(b.cost_usd)}</span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className={`lg:sticky lg:top-10 ${empty ? 'order-first lg:order-none' : ''}`}>{form}</aside>
    </div>
  );
}
