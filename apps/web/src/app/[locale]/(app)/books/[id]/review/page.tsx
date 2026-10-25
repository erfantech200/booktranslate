import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BackLink } from '@/components/BackLink';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Page photo | extracted text | translation. Stacked on mobile. Read-only in Phase 1. */
export default async function ReviewPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, id } = await params;
  const { page: pageId } = await searchParams;
  setRequestLocale(locale);
  const sb = await supabaseServer();
  const t = await getTranslations('review');
  const tb = await getTranslations('book');
  const ts = await getTranslations('status');
  const { data: book } = await sb.from('books').select('id, title, source_lang, target_lang').eq('id', id).maybeSingle();
  if (!book) notFound();
  const { data: pages } = await sb.from('pages').select('id, printed_page_number, status, normalized_path, original_name')
    .eq('book_id', id).neq('status', 'split').order('ordinal', { ascending: true, nullsFirst: false });
  const current = pages?.find((p) => p.id === pageId) ?? pages?.[0];
  const num = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);

  let photo: string | null = null;
  let blocks: { id: string; type: string; source_text: string; translated_text: string | null; user_override: string | null; lint_flags: any[]; status: string }[] = [];
  if (current) {
    const [signed, b] = await Promise.all([
      current.normalized_path ? sb.storage.from('pages').createSignedUrl(current.normalized_path, 600) : Promise.resolve({ data: null }),
      sb.from('blocks').select('id, type, source_text, translated_text, user_override, lint_flags, status')
        .eq('book_id', id).contains('page_ids', [current.id]).order('ordinal'),
    ]);
    photo = signed.data?.signedUrl ?? null;
    blocks = b.data ?? [];
  }
  const rtl = ['fa', 'ar', 'he', 'ur'].includes(book.target_lang);

  const blockClass = (type: string) => type === 'heading' ? 'font-bold' : type === 'footnote' ? 'text-sm text-muted' : '';

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <BackLink href={`/books/${id}`}><span dir="auto">{book.title}</span></BackLink>
        <h1 className="font-display text-3xl font-bold text-lajvard sm:text-4xl">{t('title')}</h1>
      </header>
      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" aria-label={t('choose')}>
        {(pages ?? []).map((p) => {
          const active = p.id === current?.id;
          const flagged = p.status === 'needs_review' || p.status === 'error';
          return (
            <Link key={p.id} href={`/books/${id}/review?page=${p.id}`} aria-current={active ? 'page' : undefined}
              className={`relative min-w-9 rounded-md px-2.5 py-1 text-center text-sm ${
                active ? 'bg-lajvard text-paper' : 'bg-surface text-ink ring-1 ring-line hover:ring-lajvard'}`}>
              {p.printed_page_number != null ? num(p.printed_page_number) : '؟'}
              {flagged && <span className="absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full bg-anar ring-2 ring-paper" aria-label={ts(p.status as any)} />}
            </Link>
          );
        })}
      </nav>
      {!current ? <p className="text-muted">{t('choose')}</p> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <section className="sheet p-3">
            <h2 className="mb-2 px-1 text-sm font-medium text-muted">
              {t('photo')}: {current.printed_page_number != null ? tb('page', { n: num(current.printed_page_number) }) : current.original_name}
            </h2>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            {photo && <img src={photo} alt="" className="w-full rounded-md" />}
          </section>
          <section className="sheet space-y-3 p-5 text-[0.9375rem] leading-7" dir="ltr" lang={book.source_lang}>
            <h2 className="text-sm font-medium text-muted">{t('source')}</h2>
            {blocks.map((b) => <p key={b.id} className={blockClass(b.type)}>{b.source_text}</p>)}
          </section>
          <section className="sheet space-y-3 border-t-4 border-t-firoozeh p-5" dir={rtl ? 'rtl' : 'ltr'} lang={book.target_lang}>
            <h2 className="text-sm font-medium text-muted">{t('translation')}</h2>
            <div className="reading space-y-3 text-[1.0625rem]">
              {blocks.map((b) => (
                <div key={b.id}>
                  <p className={blockClass(b.type)}>
                    {b.user_override ?? b.translated_text ?? <span className="font-ui text-sm text-muted">{ts(b.status as any)}</span>}
                  </p>
                  {(b.lint_flags ?? []).length > 0 && (
                    <ul className="note note-work mt-2 space-y-0.5 font-ui text-xs" dir="ltr">
                      {b.lint_flags.map((f: any, i: number) => <li key={i}>{f.message}{f.detail ? `: ${f.detail}` : ''}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
