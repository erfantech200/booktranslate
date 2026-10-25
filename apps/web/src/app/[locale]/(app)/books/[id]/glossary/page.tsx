import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GLOSSARY_KINDS, parseBookSettings } from '@bookbridge/core/shared';
import { BackLink } from '@/components/BackLink';
import { supabaseServer } from '@/lib/supabase/server';
import { addTerm, applyGlossary, deleteTerm, saveSettings, updateTerm } from '../../../../actions';

export const dynamic = 'force-dynamic';

export default async function GlossaryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const sb = await supabaseServer();
  const [{ data: book }, { data: terms }] = await Promise.all([
    sb.from('books').select('id, title, author, translator_name, settings, budget_usd, brief, target_lang').eq('id', id).maybeSingle(),
    sb.from('glossary_terms').select('id, source_term, target_term, kind, notes, locked, origin').eq('book_id', id).order('kind').order('source_term'),
  ]);
  if (!book) notFound();
  const [t, ts, tb, tl] = await Promise.all([getTranslations('glossary'), getTranslations('settings'), getTranslations('book'), getTranslations('library')]);
  const s = parseBookSettings(book.settings);
  const brief = book.brief as Record<string, string> | null;

  const TermFields = ({ term }: { term?: (typeof terms extends (infer U)[] | null ? U : never) }) => (
    <>
      <input name="source_term" defaultValue={term?.source_term} required maxLength={200} className="input" dir="ltr" aria-label={t('source')} />
      <input name="target_term" defaultValue={term?.target_term} required maxLength={200} className="input" aria-label={t('target')} />
      <select name="kind" defaultValue={term?.kind ?? 'term'} className="input" aria-label={t('kind')}>
        {GLOSSARY_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
      </select>
      <input name="notes" defaultValue={term?.notes ?? ''} maxLength={1000} className="input" aria-label={t('notes')} />
      <label className="check text-sm"><input type="checkbox" name="locked" defaultChecked={term?.locked} /> {t('locked')}</label>
    </>
  );

  const cols = 'grid grid-cols-2 items-center gap-2 lg:grid-cols-[1fr_1fr_8.5rem_1.3fr_4.5rem_5.5rem]';
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <BackLink href={`/books/${id}`}><span dir="auto">{book.title}</span></BackLink>
        <h1 className="font-display text-3xl font-bold text-lajvard sm:text-4xl">{tb('glossary')}</h1>
      </header>

      {brief && (
        <section className="sheet p-5">
          <h2 className="sheet-title mb-3">{t('brief')}</h2>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]" dir="ltr">
            {Object.entries(brief).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted first-letter:uppercase">{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <section className="sheet p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="sheet-title">{t('title')}</h2>
          <form action={applyGlossary.bind(null, id)} className="ms-auto"><button className="btn-line">{t('apply')}</button></form>
        </div>
        {(terms ?? []).length === 0 && <p className="mb-4 text-muted">{t('empty')}</p>}
        <div className={`${cols} mb-2 hidden text-sm font-medium text-muted lg:grid`} aria-hidden="true">
          <span>{t('source')}</span><span>{t('target')}</span><span>{t('kind')}</span><span>{t('notes')}</span>
        </div>
        <div className="divide-y divide-line">
          {(terms ?? []).map((term) => (
            <div key={term.id} className="flex flex-wrap items-center gap-2 py-2.5 sm:flex-nowrap">
              <form action={updateTerm.bind(null, term.id)} className={`${cols} flex-1`}>
                <TermFields term={term} />
                <button className="btn-line">{t('save')}</button>
              </form>
              <form action={deleteTerm.bind(null, term.id)}>
                <button className="rounded-md px-2 py-2 text-sm text-anar hover:bg-anar-soft">{t('delete')}</button>
              </form>
            </div>
          ))}
        </div>
        <form action={addTerm.bind(null, id)} className={`${cols} mt-3 border-t-2 border-dashed border-line pt-4 sm:me-[3.75rem]`}>
          <TermFields />
          <button className="btn">{t('add')}</button>
        </form>
      </section>

      <section className="sheet p-5">
        <h2 className="sheet-title mb-4">{ts('title')}</h2>
        <form action={saveSettings.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
          <label className="field"><span className="field-label">{tl('titleField')}</span><input name="title" defaultValue={book.title} required className="input" /></label>
          <label className="field"><span className="field-label">{tl('author')}</span><input name="author" defaultValue={book.author ?? ''} className="input" /></label>
          <label className="field"><span className="field-label">{tl('translator')}</span><input name="translator_name" defaultValue={book.translator_name ?? ''} className="input" /></label>
          <label className="field"><span className="field-label">{ts('budget')}</span><input name="budget_usd" type="number" min="0" step="0.5" defaultValue={book.budget_usd ?? ''} className="input" dir="ltr" /></label>
          <label className="field"><span className="field-label">{ts('dialogue')}</span>
            <select name="dialogueRegister" defaultValue={s.dialogueRegister} className="input">
              <option value="formal">{ts('formal')}</option><option value="spoken">{ts('spoken')}</option>
            </select>
          </label>
          <label className="field"><span className="field-label">{ts('quality')}</span>
            <select name="quality" defaultValue={s.quality} className="input">
              <option value="standard">{ts('standard')}</option><option value="premium">{ts('premium')}</option>
            </select>
          </label>
          <label className="field"><span className="field-label">{ts('font')}</span>
            <select name="bodyFont" defaultValue={s.bodyFont} className="input">
              <option value="naskh">{ts('naskh')}</option><option value="vazirmatn">{ts('vazirmatn')}</option>
            </select>
          </label>
          <label className="field"><span className="field-label">{ts('fontSize')}</span><input name="fontSizePt" type="number" min="8" max="18" step="0.5" defaultValue={s.fontSizePt} className="input" dir="ltr" /></label>
          <label className="field"><span className="field-label">{tb('pageSize')}</span>
            <select name="pageSize" defaultValue={s.pageSize} className="input">
              <option value="A5">A5</option><option value="A4">A4</option>
            </select>
          </label>
          <div className="space-y-2.5 sm:col-span-2">
            <label className="check"><input type="checkbox" name="persianDigits" defaultChecked={s.persianDigits} /> {ts('persianDigits')}</label>
            <label className="check"><input type="checkbox" name="showLatinNames" defaultChecked={s.showLatinNames} /> {ts('latinNames')}</label>
            <label className="check"><input type="checkbox" name="translatorNotes" defaultChecked={s.translatorNotes} /> {ts('notes')}</label>
          </div>
          <div className="sm:col-span-2"><button className="btn">{ts('save')}</button></div>
        </form>
      </section>
    </div>
  );
}
