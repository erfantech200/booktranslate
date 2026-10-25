import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GLOSSARY_KINDS, parseBookSettings } from '@bookbridge/core/shared';
import { Link } from '@/i18n/navigation';
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
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="locked" defaultChecked={term?.locked} /> {t('locked')}</label>
    </>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href={`/books/${id}`} className="text-sm text-slate-500 hover:text-accent">← {book.title}</Link>
      </div>

      {brief && (
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold">{t('brief')}</h2>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]" dir="ltr">
            {Object.entries(brief).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-slate-500">{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">{t('title')}</h2>
          <form action={applyGlossary.bind(null, id)} className="ms-auto"><button className="btn-ghost">{t('apply')}</button></form>
        </div>
        {(terms ?? []).length === 0 && <p className="text-sm text-slate-500">{t('empty')}</p>}
        <div className="space-y-2">
          {(terms ?? []).map((term) => (
            <div key={term.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 sm:flex-nowrap">
              <form action={updateTerm.bind(null, term.id)} className="grid flex-1 grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_1fr_8rem_1.4fr_auto_auto]">
                <TermFields term={term} />
                <button className="btn-ghost">{t('save')}</button>
              </form>
              <form action={deleteTerm.bind(null, term.id)}><button className="text-xs text-red-600">{t('delete')}</button></form>
            </div>
          ))}
          <form action={addTerm.bind(null, id)} className="grid grid-cols-2 items-center gap-2 pt-2 sm:grid-cols-[1fr_1fr_8rem_1.4fr_auto_auto]">
            <TermFields />
            <button className="btn">{t('add')}</button>
          </form>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">{ts('title')}</h2>
        <form action={saveSettings.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
          <label><span className="label">{tl('titleField')}</span><input name="title" defaultValue={book.title} required className="input" /></label>
          <label><span className="label">{tl('author')}</span><input name="author" defaultValue={book.author ?? ''} className="input" /></label>
          <label><span className="label">{tl('translator')}</span><input name="translator_name" defaultValue={book.translator_name ?? ''} className="input" /></label>
          <label><span className="label">{ts('budget')}</span><input name="budget_usd" type="number" min="0" step="0.5" defaultValue={book.budget_usd ?? ''} className="input" dir="ltr" /></label>
          <label><span className="label">{ts('dialogue')}</span>
            <select name="dialogueRegister" defaultValue={s.dialogueRegister} className="input">
              <option value="formal">{ts('formal')}</option><option value="spoken">{ts('spoken')}</option>
            </select>
          </label>
          <label><span className="label">{ts('quality')}</span>
            <select name="quality" defaultValue={s.quality} className="input">
              <option value="standard">{ts('standard')}</option><option value="premium">{ts('premium')}</option>
            </select>
          </label>
          <label><span className="label">{ts('font')}</span>
            <select name="bodyFont" defaultValue={s.bodyFont} className="input">
              <option value="naskh">{ts('naskh')}</option><option value="vazirmatn">{ts('vazirmatn')}</option>
            </select>
          </label>
          <label><span className="label">{ts('fontSize')}</span><input name="fontSizePt" type="number" min="8" max="18" step="0.5" defaultValue={s.fontSizePt} className="input" dir="ltr" /></label>
          <label><span className="label">{tb('pageSize')}</span>
            <select name="pageSize" defaultValue={s.pageSize} className="input">
              <option value="A5">A5</option><option value="A4">A4</option>
            </select>
          </label>
          <div className="space-y-2 text-sm sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="persianDigits" defaultChecked={s.persianDigits} /> {ts('persianDigits')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="showLatinNames" defaultChecked={s.showLatinNames} /> {ts('latinNames')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="translatorNotes" defaultChecked={s.translatorNotes} /> {ts('notes')}</label>
          </div>
          <div className="sm:col-span-2"><button className="btn">{ts('save')}</button></div>
        </form>
      </section>
    </div>
  );
}
