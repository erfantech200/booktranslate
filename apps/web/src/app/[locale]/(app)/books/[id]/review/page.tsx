import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
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

  return (
    <div className="space-y-4">
      <Link href={`/books/${id}`} className="text-sm text-slate-500 hover:text-accent">← {book.title}</Link>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <nav className="flex gap-1 overflow-x-auto pb-2 text-xs">
        {(pages ?? []).map((p) => (
          <Link key={p.id} href={`/books/${id}/review?page=${p.id}`}
            className={`chip ${p.id === current?.id ? 'bg-accent text-white' : p.status === 'needs_review' || p.status === 'error' ? 'chip-warn' : 'chip-idle'}`}>
            {p.printed_page_number != null ? num(p.printed_page_number) : '•'}
          </Link>
        ))}
      </nav>
      {!current ? <p className="text-slate-500">{t('choose')}</p> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card p-2">
            <h2 className="mb-2 px-2 text-sm font-semibold">{t('photo')} · {current.printed_page_number != null ? tb('page', { n: num(current.printed_page_number) }) : current.original_name}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            {photo && <img src={photo} alt="" className="w-full rounded-lg" />}
          </section>
          <section className="card space-y-3 text-sm" dir="ltr" lang={book.source_lang}>
            <h2 className="font-semibold">{t('source')}</h2>
            {blocks.map((b) => <p key={b.id} className={b.type === 'heading' ? 'font-bold' : b.type === 'footnote' ? 'text-xs text-slate-500' : ''}>{b.source_text}</p>)}
          </section>
          <section className="card space-y-3 text-sm leading-7" dir={rtl ? 'rtl' : 'ltr'} lang={book.target_lang}>
            <h2 className="font-semibold">{t('translation')}</h2>
            {blocks.map((b) => (
              <div key={b.id}>
                <p className={b.type === 'heading' ? 'font-bold' : b.type === 'footnote' ? 'text-xs text-slate-500' : ''}>
                  {b.user_override ?? b.translated_text ?? <span className="text-slate-400">{ts(b.status as any)}</span>}
                </p>
                {(b.lint_flags ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-orange-700" dir="ltr">
                    {b.lint_flags.map((f: any, i: number) => <li key={i}>⚑ {f.message}{f.detail ? ` — ${f.detail}` : ''}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
