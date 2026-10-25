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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <section className="card flex flex-wrap items-end gap-6">
        <div>
          <div className="text-xs text-slate-500">{t('thisMonth')}</div>
          <div className="text-3xl font-semibold" dir="ltr">{formatUsd(total)}</div>
        </div>
        <form action={setMonthlyBudget} className="flex items-end gap-2">
          <label><span className="label">{t('monthlyBudget')}</span>
            <input name="monthly_budget_usd" type="number" min="0" step="1" dir="ltr" className="input w-32"
              defaultValue={settings?.monthly_budget_usd ?? ''} /></label>
          <button className="btn-ghost">{t('save')}</button>
        </form>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold">{t('byModel')}</h2>
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-slate-500">
            <tr>{['stage', 'model', 'calls', 'input', 'cached', 'output', 'reasoning', 'cost'].map((k) => <th key={k} className="p-1 text-start font-medium">{t(k as any)}</th>)}</tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-1">{r.stage}</td><td className="p-1" dir="ltr">{r.model}</td>
                <td className="p-1">{fmt.format(r.calls)}</td><td className="p-1">{fmt.format(r.input_tokens)}</td>
                <td className="p-1">{fmt.format(r.cached_tokens)}</td><td className="p-1">{fmt.format(r.output_tokens)}</td>
                <td className="p-1">{fmt.format(r.reasoning_tokens)}</td><td className="p-1" dir="ltr">{formatUsd(Number(r.cost_usd))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">{t('pricesNote')}</p>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">{t('byBook')}</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {(costs ?? []).map((c) => (
            <li key={c.book_id} className="flex justify-between py-2">
              <span>{books?.find((b) => b.id === c.book_id)?.title ?? '—'}</span>
              <span dir="ltr">{formatUsd(Number(c.cost_usd))}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
