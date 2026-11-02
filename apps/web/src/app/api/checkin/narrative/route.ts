import { NextResponse, type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { BudgetExceededError, checkinNarrative } from '@coach/core';
import type { CheckinReport } from '@coach/core/shared';
import { loadLibrary } from '@/lib/library';
import { supabaseServer } from '@/lib/supabase/server';

// Weekly check-in narrative (spec §11.4), generated once per check-in after the report is saved.
// The model gets the engine's report (with exercise names) and only words it.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { checkinId } = (await req.json().catch(() => ({}))) as { checkinId?: string };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: c } = await sb.from('checkins').select('id, report, narrative, narrative_status').eq('id', checkinId ?? '').maybeSingle();
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (c.narrative_status !== 'pending') return NextResponse.json({ status: c.narrative_status, narrative: c.narrative });

  const report = c.report as CheckinReport;
  const names = new Map((await loadLibrary()).map((e) => [e.slug, e.nameFa]));
  const tp = await getTranslations('pain');
  const input = {
    ...report,
    training: report.training.map((n) =>
      n.kind === 'swap' ? { ...n, exercise: names.get(n.slug) ?? n.slug, alternative: n.to ? names.get(n.to) ?? n.to : null }
        : n.kind === 'pain' ? { ...n, areas: n.areas.map((a) => tp(`areas.${a}`)) } : n),
  };
  try {
    const narrative = await checkinNarrative(user.id, input);
    await sb.from('checkins').update({ narrative, narrative_status: 'ok' }).eq('id', c.id);
    return NextResponse.json({ status: 'ok', narrative });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'checkin narrative failed', err: err instanceof Error ? err.message : String(err) }));
    await sb.from('checkins').update({ narrative_status: 'failed' }).eq('id', c.id);
    return NextResponse.json({ status: 'failed', budget: err instanceof BudgetExceededError });
  }
}
