import 'server-only';
import {
  addDays, calorieDecision, checkinWeekEnd, COACH, isLowReadiness, isStalled, nutritionAdherence, recurringPain,
  strengthChangePct, substitutesFor, toDay, trainingNotes, waistTrend, weekContext, weightWeek,
  type CheckinReport, type TrainingNote,
} from '@coach/core/shared';
import type { CheckinNarrative } from '@coach/core';
import { loadLibrary } from './library';
import { planSummary } from './plan';
import type { Profile } from './profile';
import { firstTimes, loadFoodDays, loadMainLifts, loadMeasurements, loadPRs, loadTargetsByDate, loadWorkSets } from './progress';
import type { supabaseServer } from './supabase/server';
import { earlyDeloadCheck, eligibilityFor, loadActiveMeso, loadExcluded, loadHistory, loadReadiness, mesoInfo } from './training';
import { loadWeighIns } from './weights';

// The weekly check-in (spec §11), as the signed-in user: load the week's data, let the engine
// decide, store the report with its proposals (calories, swaps, early deload). Created once per
// week, the first time the app is opened on or after the check-in weekday.

type SB = Awaited<ReturnType<typeof supabaseServer>>;

export interface AdjustmentRow {
  id: string;
  source: 'checkin' | 'coach';
  type: 'calories' | 'swap_exercise' | 'early_deload' | 'reschedule_workout' | 'add_note' | 'regenerate_meal';
  before: any;
  after: any;
  reason: string;
  status: 'proposed' | 'approved' | 'dismissed' | 'failed';
  error: string | null;
  checkinId: string | null;
  messageId: string | null;
  createdAt: string;
}
export const adjustmentOf = (r: any): AdjustmentRow => ({
  id: r.id, source: r.source, type: r.type, before: r.before, after: r.after, reason: r.reason, status: r.status, error: r.error,
  checkinId: r.checkin_id, messageId: r.message_id, createdAt: r.created_at,
});

export interface CheckinRow {
  id: string;
  weekEnd: string;
  report: CheckinReport;
  narrative: CheckinNarrative | null;
  narrativeStatus: 'pending' | 'ok' | 'failed';
  createdAt: string;
}
const checkinOf = (r: any): CheckinRow => ({
  id: r.id, weekEnd: r.week_end, report: r.report, narrative: r.narrative, narrativeStatus: r.narrative_status, createdAt: r.created_at,
});

export const checkinWeekday = (p: Profile) => p.checkin_weekday ?? COACH.checkin.defaultWeekday;

/** The last day a calorie change (weekly or manual) took effect, if any. */
export async function lastCalorieChange(sb: SB): Promise<string | null> {
  const { data } = await sb.from('nutrition_targets').select('effective_from').in('reason', ['weekly_adjustment', 'manual'])
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();
  return data?.effective_from ?? null;
}

/** The engine's report for the week ending `weekEnd` (nothing is written). */
export async function buildCheckinReport(sb: SB, profile: Profile, weekEnd: string, today: string, currentSurplus: number) {
  const from = addDays(weekEnd, -6);
  const [weighIns, measurements, work, mains, prs, block, readiness, pain, foodDays, targetFor, lastChange, library, excluded] = await Promise.all([
    loadWeighIns(sb), loadMeasurements(sb), loadWorkSets(sb), loadMainLifts(sb), loadPRs(sb), loadActiveMeso(sb),
    loadReadiness(sb, from), sb.from('pain_reports').select('date, area, level').gte('date', addDays(weekEnd, -60)),
    loadFoodDays(sb, from), loadTargetsByDate(sb), lastCalorieChange(sb), loadLibrary(), loadExcluded(sb),
  ]);
  const plan = planSummary(profile, weighIns, weekEnd);
  const weight = weightWeek(weighIns, weekEnd, plan.ratePct);
  const waistPerMonth = waistTrend(measurements, weekEnd);
  const strengthPct = strengthChangePct(work.sets, mains, addDays(weekEnd, -COACH.progress.qualityWindowDays), weekEnd);
  const calories = calorieDecision({ weight, waistPerMonth, strengthPct: strengthPct == null ? null : Math.round(strengthPct * 10) / 10, currentSurplus, lastChange, today });

  // Training signals from the active block.
  const stalled: { slug: string; to: string | null }[] = [];
  let earlyDeload: 'regression' | 'readiness' | null = null;
  if (block) {
    const inBlock = new Set(block.days.flatMap((d) => d.exercises.map((x) => x.slug)));
    const candidates = [...new Set(block.days.flatMap((d) => d.exercises.filter((x) => x.role !== 'isolation').map((x) => x.slug)))];
    const { exposures } = await loadHistory(sb, candidates);
    const el = eligibilityFor(profile, excluded, block.meso.blockNo);
    for (const slug of candidates) {
      if (!isStalled(exposures.get(slug) ?? [])) continue;
      const e = library.find((x) => x.slug === slug);
      const to = e ? substitutesFor(e, library, el).find((x) => !inBlock.has(x.slug))?.slug ?? null : null;
      stalled.push({ slug, to });
    }
    const wc = weekContext(mesoInfo(block.meso), profile.experience ?? 'none', today);
    earlyDeload = await earlyDeloadCheck(sb, block.meso, block.days, today, wc);
  }
  const painRows = (pain.data ?? []) as { date: string; area: string; level: number }[];
  const areas = [...new Set(painRows.filter((r) => r.date >= from && r.date <= weekEnd).map((r) => r.area))];
  const workoutsDone = new Set(work.sessions.filter((s) => s.date >= from && s.date <= weekEnd).map((s) => s.date)).size;
  const workoutsPlanned = block ? block.meso.daysPerWeek : 0;
  const training: TrainingNote[] = trainingNotes({
    stalled, earlyDeload,
    lowReadinessDays: readiness.filter((r) => r.date >= from && r.date <= weekEnd && isLowReadiness(r)).length,
    recurringPainAreas: areas.filter((a) => recurringPain(painRows, a, weekEnd)),
    workoutsDone, workoutsPlanned,
  });
  const nut = nutritionAdherence(foodDays.filter((x) => x.date >= from && x.date <= weekEnd), targetFor);
  const first = firstTimes(work.sets);
  const report: CheckinReport = {
    weekStart: from, weekEnd, weight, waistPerMonth, strengthPct: strengthPct == null ? null : Math.round(strengthPct * 10) / 10,
    calories, training,
    adherence: { workoutsDone, workoutsPlanned, proteinDays: nut.proteinHit, kcalDays: nut.kcalHit, loggedDays: nut.logged },
    prs: prs.filter((p) => p.date >= from && p.date <= weekEnd && first.get(p.slug) !== p.date).length,
  };
  return report;
}

/**
 * This week's check-in: the existing one, or a new one when its week has ended (and the plan has
 * run at least a week). Returns null when none is due yet.
 */
export async function ensureCheckin(sb: SB, userId: string, profile: Profile, today: string, currentSurplus: number): Promise<CheckinRow | null> {
  const weekEnd = checkinWeekEnd(today, checkinWeekday(profile));
  if (!profile.start_date || toDay(weekEnd) - toDay(profile.start_date) < 6) return latestCheckin(sb);
  const { data: have, error: e0 } = await sb.from('checkins').select('*').eq('week_end', weekEnd).maybeSingle();
  if (e0) return null; // table missing (before the Phase 5 migration): no check-in, no crash
  if (have) return checkinOf(have);

  const report = await buildCheckinReport(sb, profile, weekEnd, today, currentSurplus);
  const { data: row, error } = await sb.from('checkins').insert({ user_id: userId, week_end: weekEnd, report }).select('*').single();
  if (error || !row) {
    // A parallel request created it first.
    const { data: again } = await sb.from('checkins').select('*').eq('week_end', weekEnd).maybeSingle();
    return again ? checkinOf(again) : null;
  }
  const proposals: Record<string, unknown>[] = [];
  const base = { user_id: userId, source: 'checkin', checkin_id: row.id };
  if (report.calories.delta !== 0) {
    proposals.push({ ...base, type: 'calories', before: { surplus: report.calories.currentSurplus },
      after: { surplus: report.calories.newSurplus, delta: report.calories.delta }, reason: report.calories.reason });
  }
  for (const n of report.training) {
    if (n.kind === 'swap' && n.to) proposals.push({ ...base, type: 'swap_exercise', before: { slug: n.slug }, after: { from: n.slug, to: n.to }, reason: 'stalled' });
    if (n.kind === 'early_deload') proposals.push({ ...base, type: 'early_deload', before: null, after: { reason: n.reason }, reason: n.reason });
  }
  if (proposals.length) await sb.from('adjustments').insert(proposals);
  return checkinOf(row);
}

export async function latestCheckin(sb: SB): Promise<CheckinRow | null> {
  const { data, error } = await sb.from('checkins').select('*').order('week_end', { ascending: false }).limit(1).maybeSingle();
  return error || !data ? null : checkinOf(data);
}

export async function loadCheckin(sb: SB, id: string): Promise<CheckinRow | null> {
  const { data } = await sb.from('checkins').select('*').eq('id', id).maybeSingle();
  return data ? checkinOf(data) : null;
}

export async function loadAdjustments(sb: SB, by: { checkinId?: string; messageIds?: string[] }): Promise<AdjustmentRow[]> {
  let q = sb.from('adjustments').select('*').order('created_at');
  if (by.checkinId) q = q.eq('checkin_id', by.checkinId);
  if (by.messageIds) q = q.in('message_id', by.messageIds.length ? by.messageIds : ['00000000-0000-0000-0000-000000000000']);
  const { data, error } = await q;
  return error ? [] : (data ?? []).map(adjustmentOf);
}
