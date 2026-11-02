import { getTranslations, setRequestLocale } from 'next-intl/server';
import { addDays, checkinWeekEnd } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { ChatPanel, type ChatMessage } from '@/components/coach/ChatPanel';
import { checkinWeekday, ensureCheckin, loadAdjustments } from '@/lib/checkin';
import { fmtDate, fmtNum } from '@/lib/format';
import { librarySlugMap } from '@/lib/library';
import { ensureTargets, loadPlan, weekStartOf } from '@/lib/nutrition';
import { requireProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

/** Coach tab: this week's check-in at the top, the chat below (spec §11, §12). */
export default async function CoachPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, user, profile } = await requireProfile();
  const t = await getTranslations('coach');
  const tc = await getTranslations('checkin');
  const d = profile.digits;
  const today = await localToday();
  const targets = await ensureTargets(sb, user.id, profile, today);
  const [checkin, bySlug, plan, { data: msgs }] = await Promise.all([
    ensureCheckin(sb, user.id, profile, today, targets.surplus), librarySlugMap(), loadPlan(sb, weekStartOf(today)),
    sb.from('coach_messages').select('id, role, content, created_at').order('created_at', { ascending: false }).limit(60),
  ]);
  const messages = ((msgs ?? []) as ChatMessage[]).reverse();
  const [checkinAdj, chatAdj] = await Promise.all([
    checkin ? loadAdjustments(sb, { checkinId: checkin.id }) : Promise.resolve([]),
    loadAdjustments(sb, { messageIds: messages.filter((m) => m.role === 'assistant').map((m) => m.id) }),
  ]);
  const names = Object.fromEntries([...bySlug].map(([slug, e]) => [slug, e.nameFa]));
  const meals = Object.fromEntries((plan?.meals ?? []).map((m) => [m.id, m.nameFa]));
  const pendingCount = checkinAdj.filter((a) => a.status === 'proposed').length;
  const lastEnd = checkinWeekEnd(today, checkinWeekday(profile));
  const next = lastEnd === today && !checkin ? today : addDays(lastEnd, 7);

  return (
    <div className="space-y-4 pt-2">
      <header className="rise">
        <h1 className="text-3xl font-extrabold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('intro')}</p>
      </header>

      <section className={`card ${pendingCount ? 'border-accent' : ''}`} aria-labelledby="ck-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ck-h" className="card-title">{t('checkinTitle')}</h2>
          <span className="text-xs text-muted">{t('checkinNext', { date: fmtDate(next, d, { weekday: 'long', day: 'numeric', month: 'short' }) })}</span>
        </div>
        {checkin ? (
          <>
            <p className="mt-1 text-sm text-muted">{tc('week', { from: fmtDate(checkin.report.weekStart, d, { day: 'numeric', month: 'short' }), to: fmtDate(checkin.weekEnd, d, { day: 'numeric', month: 'short' }) })}</p>
            {pendingCount > 0 && <p className="mt-2 font-bold text-accent-text">{t('pendingProposals', { n: pendingCount, count: fmtNum(pendingCount, d) })}</p>}
            {checkin.narrative?.focus?.[0] && <p className="mt-2 leading-7">{checkin.narrative.focus[0]}</p>}
            <Link href={`/coach/checkin/${checkin.id}`} className="btn btn-secondary mt-3 w-full">{t('checkinOpen')}</Link>
          </>
        ) : <p className="mt-2 text-muted">{t('checkinNone')}</p>}
      </section>

      <ChatPanel initial={messages} digits={d} names={names} meals={meals}
        proposals={chatAdj.map((a) => ({ ...a, messageId: a.messageId }))} />
    </div>
  );
}
