import 'server-only';
import {
  availableEquipment, bestsFrom, earlyDeloadReason, generateProgram, holdRamp, isLowReadiness, isStalled, maxDifficultyFor,
  mergeSessions, planExercise, planSession, repRangeFor, rescheduleOptions, restFor, setsFor, trainingDays, weekContext,
  weekOf, weekState,
  type Bests, type DayKind, type Eligibility, type Exercise, type Exposure, type LoggedSet, type MesoInfo, type PlannedExercise,
  type ProgramItem, type Readiness, type Role, type SessionPlan, type SessionSummary, type WeekContext,
} from '@coach/core/shared';
import type { GymExercise } from '@/components/gym/types';
import { loadLibrary } from './library';
import { allRows } from './paged';
import type { Profile } from './profile';
import type { supabaseServer } from './supabase/server';

// Training data access (as the signed-in user, RLS) plus the glue between the database and the
// deterministic engine: build a block, prepare a session's plan, load history.

type SB = Awaited<ReturnType<typeof supabaseServer>>;

export interface Meso {
  id: string;
  seq: number;
  blockNo: number;
  startDate: string;
  weeks: number;
  deloadWeek: number;
  earlyDeloadReason: 'regression' | 'readiness' | null;
  daysPerWeek: number;
  sessionMinutes: number;
  trainingDays: number[];
  missing: string[];
  createdAt: string;
}
export interface PEx { id: string; idx: number; slug: string; role: Role; sets: number[]; reps: [number, number]; restSec: number; replacedFrom: string | null }
export interface PDay { id: string; idx: number; kind: DayKind; exercises: PEx[] }
export interface SessionRow {
  id: string;
  week: number;
  dayIdx: number;
  mergedDayIdx: number | null;
  date: string;
  status: 'active' | 'done' | 'skipped';
  deload: boolean;
  plan: SessionPlan | null;
  summary: SessionSummary | null;
  coachComment: string | null;
  commentStatus: 'none' | 'pending' | 'ok' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
}

const mesoOf = (r: any): Meso => ({
  id: r.id, seq: r.seq, blockNo: r.block_no, startDate: r.start_date, weeks: r.weeks, deloadWeek: r.deload_week,
  earlyDeloadReason: r.early_deload_reason, daysPerWeek: r.days_per_week, sessionMinutes: r.session_minutes,
  trainingDays: r.training_days, missing: r.missing_patterns, createdAt: r.created_at,
});
export const sessionOf = (r: any): SessionRow => ({
  id: r.id, week: r.week, dayIdx: r.day_idx, mergedDayIdx: r.merged_day_idx, date: r.date, status: r.status, deload: r.deload,
  plan: r.plan, summary: r.summary, coachComment: r.coach_comment, commentStatus: r.comment_status,
  startedAt: r.started_at, finishedAt: r.finished_at,
});
export const mesoInfo = (m: Meso): MesoInfo => ({ seq: m.blockNo, startDate: m.startDate, weeks: m.weeks, deloadWeek: m.deloadWeek });

export async function loadActiveMeso(sb: SB): Promise<{ meso: Meso; days: PDay[] } | null> {
  const { data: m } = await sb.from('mesocycles').select('*').eq('status', 'active').maybeSingle();
  if (!m) return null;
  const { data: days, error } = await sb.from('program_days')
    .select('id, idx, kind, program_exercises(id, idx, slug, role, sets_by_week, rep_min, rep_max, rest_sec, replaced_from)')
    .eq('mesocycle_id', m.id).order('idx');
  if (error) throw new Error(error.message);
  return {
    meso: mesoOf(m),
    days: (days ?? []).map((d: any) => ({
      id: d.id, idx: d.idx, kind: d.kind,
      exercises: [...d.program_exercises].sort((a: any, b: any) => a.idx - b.idx).map((x: any) => ({
        id: x.id, idx: x.idx, slug: x.slug, role: x.role, sets: x.sets_by_week, reps: [x.rep_min, x.rep_max], restSec: x.rest_sec, replacedFrom: x.replaced_from,
      })),
    })),
  };
}

export async function loadSessions(sb: SB, mesoId: string): Promise<SessionRow[]> {
  const { data } = await sb.from('workout_sessions')
    .select('id, week, day_idx, merged_day_idx, date, status, deload, summary, coach_comment, comment_status, started_at, finished_at, plan:plan->kinds')
    .eq('mesocycle_id', mesoId).order('date').order('created_at');
  return (data ?? []).map((r: any) => ({ ...sessionOf(r), plan: r.plan ? ({ kinds: r.plan } as SessionPlan) : null }));
}

export async function loadReadiness(sb: SB, since: string): Promise<(Readiness & { id: string })[]> {
  const { data } = await sb.from('readiness').select('id, date, sleep_hours, energy, soreness').gte('date', since).order('date');
  return (data ?? []).map((r) => ({
    id: r.id, date: r.date, sleepHours: r.sleep_hours == null ? null : Number(r.sleep_hours), energy: r.energy, soreness: r.soreness,
  }));
}

export async function loadExcluded(sb: SB): Promise<Set<string>> {
  const { data } = await sb.from('exercise_prefs').select('slug').eq('excluded', true);
  return new Set((data ?? []).map((r) => r.slug));
}

/** Working sets of finished sessions, grouped into exposures per exercise (oldest first), and all-time bests. */
export async function loadHistory(sb: SB, slugs?: string[]): Promise<{ exposures: Map<string, Exposure[]>; bests: Map<string, Bests> }> {
  const { data: sessions } = await sb.from('workout_sessions').select('id, date, deload').eq('status', 'done');
  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  const sets = await allRows((from, to) => {
    let q = sb.from('set_logs').select('slug, session_id, weight_kg, reps, rir, rep_min, rep_max, target_rir, logged_at')
      .eq('is_warmup', false).order('logged_at').order('id');
    if (slugs) q = q.in('slug', slugs);
    return q.range(from, to);
  });
  const exposures = new Map<string, Exposure[]>();
  const all = new Map<string, LoggedSet[]>();
  const open = new Map<string, Exposure>();
  for (const s of sets) {
    const session = byId.get(s.session_id);
    if (!session) continue; // active or deleted session
    const set: LoggedSet = { weight: Number(s.weight_kg), reps: s.reps, rir: s.rir == null ? null : Number(s.rir) };
    all.set(s.slug, [...(all.get(s.slug) ?? []), set]);
    const key = `${s.slug}|${s.session_id}`;
    let x = open.get(key);
    if (!x) {
      x = { date: session.date, sets: [], reps: [s.rep_min ?? 8, s.rep_max ?? 12], targetRir: s.target_rir == null ? 2 : Number(s.target_rir), deload: session.deload };
      open.set(key, x);
      exposures.set(s.slug, [...(exposures.get(s.slug) ?? []), x]);
    }
    x.sets.push(set);
  }
  for (const list of exposures.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return { exposures, bests: new Map([...all].map(([slug, xs]) => [slug, bestsFrom(xs)])) };
}

export function eligibilityFor(profile: Profile, excluded: ReadonlySet<string>, blockNo: number): Eligibility {
  return {
    equipment: availableEquipment({ trainLocation: profile.train_location ?? 'gym', equipment: profile.equipment }),
    injuryAreas: profile.injury_areas,
    excluded,
    maxDifficulty: maxDifficultyFor(profile.experience ?? 'none', blockNo),
  };
}

/**
 * Close the active block (if any) and build the next one from the profile. `completed` = the
 * previous block ran its course (the training block number advances); `rebuilt` = settings
 * changed mid-block (the block number stays, so technique weeks and difficulty don't jump).
 */
export async function buildBlock(sb: SB, userId: string, profile: Profile, today: string, reason: 'completed' | 'rebuilt' | 'first'): Promise<string> {
  const [library, excluded, { data: last }] = await Promise.all([
    loadLibrary(), loadExcluded(sb),
    sb.from('mesocycles').select('id, seq, block_no, status').order('seq', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const seq = (last?.seq ?? 0) + 1;
  const blockNo = !last ? 1 : reason === 'rebuilt' ? last.block_no : last.block_no + 1;

  // Stalled lifts of the last block go to the back of the queue (spec §6: swap at the next block).
  const avoid = new Set<string>();
  if (last && reason === 'completed') {
    const { data: prev } = await sb.from('program_exercises').select('slug, program_days!inner(mesocycle_id)').eq('program_days.mesocycle_id', last.id);
    const slugs = [...new Set((prev ?? []).map((r) => r.slug))];
    const { exposures } = await loadHistory(sb, slugs);
    for (const s of slugs) if (isStalled(exposures.get(s) ?? [])) avoid.add(s);
  }

  const program = generateProgram({
    experience: profile.experience ?? 'none',
    daysPerWeek: profile.days_per_week ?? 3,
    sessionMinutes: profile.session_minutes ?? 60,
    library,
    eligibility: eligibilityFor(profile, excluded, blockNo),
    avoid,
  });

  if (last?.status === 'active') {
    const { error } = await sb.from('mesocycles').update({ status: 'done', ended_reason: reason === 'rebuilt' ? 'rebuilt' : 'completed', ended_at: new Date().toISOString() }).eq('id', last.id);
    if (error) throw new Error(error.message);
  }
  const { data: meso, error } = await sb.from('mesocycles').insert({
    user_id: userId, seq, block_no: blockNo, start_date: today, weeks: program.weeks, deload_week: program.weeks,
    days_per_week: profile.days_per_week ?? 3, session_minutes: profile.session_minutes ?? 60,
    training_days: trainingDays(profile.days_per_week ?? 3, profile.preferred_days), missing_patterns: program.missing,
  }).select('id').single();
  if (error || !meso) throw new Error(error?.message ?? 'mesocycle insert failed');

  try {
    const { data: days, error: e1 } = await sb.from('program_days')
      .insert(program.days.map((d, idx) => ({ user_id: userId, mesocycle_id: meso.id, idx, kind: d.kind }))).select('id, idx');
    if (e1 || !days) throw new Error(e1?.message ?? 'program_days insert failed');
    const dayId = new Map(days.map((d) => [d.idx, d.id]));
    const rows = program.days.flatMap((d, di) => d.exercises.map((x, idx) => ({
      user_id: userId, program_day_id: dayId.get(di), idx, slug: x.slug, role: x.role, sets_by_week: x.sets,
      rep_min: x.reps[0], rep_max: x.reps[1], rest_sec: x.restSec,
    })));
    const { error: e2 } = await sb.from('program_exercises').insert(rows);
    if (e2) throw new Error(e2.message);
  } catch (err) {
    // Roll back by hand (no multi-statement transactions through the API).
    await sb.from('mesocycles').delete().eq('id', meso.id);
    if (last?.status === 'active') await sb.from('mesocycles').update({ status: 'active', ended_reason: null, ended_at: null }).eq('id', last.id);
    throw err;
  }
  return meso.id;
}

// ─── Week state for the Workout tab ───────────────────────────────────────────────────────
export function weekView(meso: Meso, days: PDay[], sessions: SessionRow[], today: string) {
  const weekNow = weekOf(meso.startDate, today);
  const over = weekNow > meso.deloadWeek;
  const handled = new Set<number>();
  for (const s of sessions) {
    if (s.week !== weekNow || s.status === 'active') continue;
    handled.add(s.dayIdx);
    if (s.mergedDayIdx != null) handled.add(s.mergedDayIdx);
  }
  const state = weekState({ startDate: meso.startDate, today, days: meso.trainingDays, programDays: days.length, handled });
  return { weekNow, over, handled, state, options: rescheduleOptions(state) };
}

export function itemsForDay(day: PDay, wc: WeekContext, o: { holdRamp: boolean; lowReadiness: boolean }): ProgramItem[] {
  return day.exercises.map((x) => ({ slug: x.slug, role: x.role, sets: setsFor(x.sets, wc, o), reps: x.reps, restSec: x.restSec }));
}

/** The prescription for one program day (optionally merged with the next one). */
export async function preparePlan(sb: SB, o: {
  profile: Profile; meso: Meso; days: PDay[]; dayIdx: number; mergeWith: number | null; today: string; dropLastSet: boolean;
}): Promise<SessionPlan> {
  const library = await loadLibrary();
  const bySlug = new Map<string, Exercise>(library.map((e) => [e.slug, e]));
  const wc = weekContext(mesoInfo(o.meso), o.profile.experience ?? 'none', o.today);
  const readiness = await loadReadiness(sb, isoMinusDays(o.today, 7));
  const opts = { holdRamp: holdRamp(readiness, o.today), lowReadiness: o.dropLastSet };
  const day = o.days[o.dayIdx]!;
  let items = itemsForDay(day, wc, opts);
  const kinds: DayKind[] = [day.kind];
  if (o.mergeWith != null && o.days[o.mergeWith]) {
    const other = o.days[o.mergeWith]!;
    const b = itemsForDay(other, wc, opts);
    const all = new Map([...items, ...b].map((x) => [x.slug, x]));
    const merged = mergeSessions(
      items.map((x) => ({ slug: x.slug, role: x.role, sets: x.sets, pattern: bySlug.get(x.slug)!.pattern })),
      b.map((x) => ({ slug: x.slug, role: x.role, sets: x.sets, pattern: bySlug.get(x.slug)!.pattern })),
      o.meso.sessionMinutes,
    );
    items = merged.map((m) => ({ ...all.get(m.slug)!, sets: m.sets }));
    kinds.push(other.kind);
  }
  const { exposures, bests } = await loadHistory(sb, items.map((x) => x.slug));
  return planSession(kinds, items, { bySlug, wc, history: exposures, bests, injuryAreas: o.profile.injury_areas }, o.dropLastSet);
}

/** Replace one exercise of a running session's plan with a substitute (same role and sets). */
export async function swapInPlan(sb: SB, profile: Profile, plan: SessionPlan, exIdx: number, slug: string): Promise<PlannedExercise> {
  const library = await loadLibrary();
  const bySlug = new Map<string, Exercise>(library.map((e) => [e.slug, e]));
  const cur = plan.exercises[exIdx];
  const e = bySlug.get(slug);
  if (!cur || !e) throw new Error('unknown exercise');
  const { exposures, bests } = await loadHistory(sb, [slug]);
  const wc: WeekContext = { week: plan.week, deload: plan.deload, technique: plan.technique };
  const item: ProgramItem = { slug, role: cur.role, sets: cur.sets, reps: repRangeFor(e, cur.role, profile.experience ?? 'none'), restSec: restFor(e, cur.role) };
  const first = cur.warmups.length >= 3;
  return { ...planExercise(item, { bySlug, wc, history: exposures, bests, injuryAreas: profile.injury_areas }, first), swappedFrom: cur.swappedFrom ?? cur.slug };
}

/** Early-deload suggestion for the current block, or null. */
export async function earlyDeloadCheck(sb: SB, meso: Meso, days: PDay[], today: string, wc: WeekContext): Promise<'regression' | 'readiness' | null> {
  if (wc.deload || meso.earlyDeloadReason) return null;
  const mains = [...new Set(days.flatMap((d) => d.exercises.filter((x) => x.role === 'main').map((x) => x.slug)))];
  const [{ exposures }, readiness] = await Promise.all([loadHistory(sb, mains), loadReadiness(sb, isoMinusDays(today, 7))]);
  return earlyDeloadReason({ mainLifts: mains.map((s) => exposures.get(s) ?? []), readiness, today });
}

export const todayIsLow = (r: Readiness | undefined) => !!r && isLowReadiness(r);

export function isoMinusDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export const holdRampFor = (entries: Readiness[], today: string) => holdRamp(entries, today);

/** The part of an exercise gym mode shows. */
export const gymInfo = (e: Exercise): GymExercise => ({
  slug: e.slug, nameFa: e.nameFa, timed: e.timed, loadType: e.loadType, unilateral: e.unilateral,
  cues: e.cues, setup: e.setup, execution: e.execution,
});
