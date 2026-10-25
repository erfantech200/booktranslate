import { getTranslations, setRequestLocale } from 'next-intl/server';
import { supabaseServer } from '@/lib/supabase/server';
import { formatUsd } from '@/lib/data';
import { setMonthlyBudget } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function UsagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('usage');
  const sb = await supabaseServer();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [{ data: rows }, { data: books }, { data: costs }, { data: settings }] = await Promise.all([
    sb.from('monthly_costs').select('*').gte('month', monthStart).order('cost_usd', { ascending: false }),
    sb.from('books').select('id, title'),
    sb.from('book_costs').select('*'),
    sb.from('user_settings').select('monthly_budget_usd').maybeSingle(),
  ]);
  const total = (rows ?? []).reduce((n, r) => n + Number(r.cost_usd), 0);
  const fmt = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="space-y-8">
      <h1 className="font-display text-4xl font-bold text-lajvard">{t('title')}</h1>
      <section className="sheet flex flex-wrap items-end justify-between gap-6 p-5">
        <div>
          <h2 className="text-sm text-muted">{t('thisMonth')}</h2>
          <p className="mt-1 font-display text-4xl font-bold text-lajvard" dir="ltr">{formatUsd(total)}</p>
        </div>
        <form action={setMonthlyBudget} className="flex items-end gap-2">
          <label className="field"><span className="field-label">{t('monthlyBudget')}</span>
            <input name="monthly_budget_usd" type="number" min="0" step="1" dir="ltr" className="input w-32"
              defaultValue={settings?.monthly_budget_usd ?? ''} /></label>
          <button className="btn-line">{t('save')}</button>
        </form>
      </section>

      <section className="sheet p-5">
        <h2 className="sheet-title mb-4">{t('byModel')}</h2>
        {(rows ?? []).length === 0 ? <p className="text-muted">{t('none')}</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">{['stage', 'model', 'calls', 'input', 'cached', 'output', 'reasoning', 'cost'].map((k, i) => (
                  <th key={k} className={`px-2 pb-2 font-medium ${i < 2 ? 'text-start' : 'text-end'}`}>{t(k as any)}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(rows ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2.5">{r.stage}</td><td className="px-2 py-2.5" dir="ltr">{r.model}</td>
                    {[r.calls, r.input_tokens, r.cached_tokens, r.output_tokens, r.reasoning_tokens].map((v, j) => (
                      <td key={j} className="px-2 py-2.5 text-end tabular-nums">{fmt.format(v)}</td>))}
                    <td className="px-2 py-2.5 text-end font-medium" dir="ltr">{formatUsd(Number(r.cost_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[0.8125rem] text-muted">{t('pricesNote')}</p>
      </section>

      <section className="sheet p-5">
        <h2 className="sheet-title mb-3">{t('byBook')}</h2>
        <ul className="divide-y divide-line">
          {(costs ?? []).map((c) => (
            <li key={c.book_id} className="flex justify-between gap-4 py-2.5">
              <span>{books?.find((b) => b.id === c.book_id)?.title ?? ''}</span>
              <span className="font-medium" dir="ltr">{formatUsd(Number(c.cost_usd))}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
