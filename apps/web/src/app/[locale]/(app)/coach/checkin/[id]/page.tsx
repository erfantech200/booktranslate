import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CheckinNarrative } from '@/components/coach/CheckinNarrative';
import { CheckinReportView } from '@/components/coach/CheckinReportView';
import { ProposalCard } from '@/components/coach/ProposalCard';
import { loadAdjustments, loadCheckin } from '@/lib/checkin';
import { fmtDate } from '@/lib/format';
import { librarySlugMap } from '@/lib/library';
import { requireProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

/** One weekly check-in (spec §11): the numbers, the coach's words, and the proposals to approve. */
export default async function CheckinPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const c = await loadCheckin(sb, id);
  if (!c) notFound();
  const t = await getTranslations('checkin');
  const tco = await getTranslations('coach');
  const d = profile.digits;
  const [adj, bySlug, { data: past }] = await Promise.all([
    loadAdjustments(sb, { checkinId: c.id }), librarySlugMap(),
    sb.from('checkins').select('id, week_end').neq('id', c.id).order('week_end', { ascending: false }).limit(12),
  ]);
  const names = Object.fromEntries([...bySlug].map(([slug, e]) => [slug, e.nameFa]));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <Link href="/coach" className="btn btn-ghost">{tco('title')}</Link>
      </div>
      {adj.length > 0 && (
        <section className="card border-accent" aria-labelledby="prop-h">
          <h2 id="prop-h" className="card-title">{t('proposals')}</h2>
          <p className="field-hint mt-0">{t('proposalsHint')}</p>
          <div className="mt-3 space-y-2">
            {adj.map((a) => <ProposalCard key={a.id} p={a} names={names} digits={d} />)}
          </div>
        </section>
      )}
      <CheckinNarrative checkinId={c.id} initial={c.narrative} status={c.narrativeStatus} />
      <CheckinReportView r={c.report} names={names} digits={d} />
      {(past ?? []).length > 0 && (
        <section className="card" aria-labelledby="past-h">
          <h2 id="past-h" className="card-title">{tco('history')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {(past ?? []).map((p) => (
              <li key={p.id}><Link href={`/coach/checkin/${p.id}`} className="block py-2.5">{fmtDate(p.week_end, d, { day: 'numeric', month: 'long', year: 'numeric' })}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
