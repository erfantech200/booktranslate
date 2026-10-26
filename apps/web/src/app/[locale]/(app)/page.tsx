import { getTranslations, setRequestLocale } from 'next-intl/server';
import { WeighInCard } from '@/components/WeighInCard';
import { fmtDate, fmtNum } from '@/lib/format';
import { planSummary } from '@/lib/plan';
import { requireProfile } from '@/lib/profile';
import { loadWeighIns } from '@/lib/weights';

export const dynamic = 'force-dynamic';

export default async function TodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('today');
  const weighIns = await loadWeighIns(sb);
  const s = planSummary(profile, weighIns);
  const d = profile.digits;
  const gained = s.current != null ? Math.max(0, s.current - s.startKg) : 0;
  const total = s.target12m - s.startKg;
  const pct = total > 0 ? Math.min(100, (gained / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <header className="rise pt-2 pb-2">
        <p className="text-muted">{fmtDate(new Date().toISOString().slice(0, 10), d, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-3xl font-extrabold">{t('greeting')}</h1>
        <p className="mt-1 text-sm text-muted num">{t('day', { n: fmtNum(Math.min(365, s.dayNumber), d), total: fmtNum(365, d) })}</p>
      </header>

      {profile.cardio_risk && <p role="note" className="note note-warn">{t('clearance')}</p>}

      <WeighInCard recent={weighIns.slice(-14).map(({ date, weightKg }) => ({ date, weightKg }))} avg7={s.current} digits={d} />

      <section className="card" aria-labelledby="goal-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="goal-h" className="card-title">{t('goal')}</h2>
          <span className="text-sm text-muted num">{t('goalRange', { from: fmtNum(s.startKg, d), to: fmtNum(s.target12m, d) })}</span>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm num">{t('towardGoal', { done: fmtNum(gained, d), total: fmtNum(total, d) })}</p>
        <p className="field-hint">{t('goalNote')}</p>
      </section>

      <section className="card">
        <h2 className="card-title">{t('comingTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('coming')}</p>
      </section>
    </div>
  );
}
