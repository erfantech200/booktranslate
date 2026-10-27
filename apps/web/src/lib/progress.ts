import 'server-only';
import { COACH, type FoodDay, type Measurement, type PRKind, type WorkSet } from '@coach/core/shared';
import { allRows } from './paged';
import { PHOTO_BUCKET, type Angle } from './photos';
import type { supabaseServer } from './supabase/server';

// Read side of the Progress screens (as the signed-in user, RLS). All math is in
// packages/core/src/engine/progress.ts; this only shapes rows.

type SB = Awaited<ReturnType<typeof supabaseServer>>;
const num = (v: unknown) => (v == null ? null : Number(v));

export interface MeasurementRow extends Measurement { id: string; weightKg: number | null }

/** Days with at least one tape measurement, oldest first. */
export async function loadMeasurements(sb: SB): Promise<MeasurementRow[]> {
  const { data } = await sb.from('body_metrics').select('id, date, weight_kg, waist_cm, chest_cm, arm_cm, thigh_cm')
    .or('waist_cm.not.is.null,chest_cm.not.is.null,arm_cm.not.is.null,thigh_cm.not.is.null').order('date');
  return (data ?? []).map((r) => ({
    id: r.id, date: r.date, weightKg: num(r.weight_kg), waist: num(r.waist_cm), chest: num(r.chest_cm), arm: num(r.arm_cm), thigh: num(r.thigh_cm),
  }));
}

export interface DoneSession { id: string; date: string }

/** Working sets of finished sessions (all time), with each session's date. */
export async function loadWorkSets(sb: SB): Promise<{ sets: WorkSet[]; sessions: DoneSession[] }> {
  const { data: sessions } = await sb.from('workout_sessions').select('id, date').eq('status', 'done').order('date');
  const date = new Map((sessions ?? []).map((s) => [s.id, s.date as string]));
  const rows = await allRows((from, to) => sb.from('set_logs').select('session_id, slug, weight_kg, reps')
    .eq('is_warmup', false).order('logged_at').order('id').range(from, to));
  const sets: WorkSet[] = [];
  for (const r of rows) {
    const d = date.get(r.session_id);
    if (d) sets.push({ date: d, slug: r.slug, weight: Number(r.weight_kg ?? 0), reps: r.reps });
  }
  return { sets, sessions: (sessions ?? []).map((s) => ({ id: s.id, date: s.date })) };
}

/** The first session date of each exercise (its baseline; records count from the next one). */
export function firstTimes(sets: readonly WorkSet[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sets) if (!m.has(s.slug) || s.date < m.get(s.slug)!) m.set(s.slug, s.date);
  return m;
}

/** Exercises that were a block's main lift, most-programmed first. */
export async function loadMainLifts(sb: SB): Promise<string[]> {
  const { data } = await sb.from('program_exercises').select('slug').eq('role', 'main');
  const n = new Map<string, number>();
  for (const r of data ?? []) n.set(r.slug, (n.get(r.slug) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

export interface PRRow { date: string; slug: string; kinds: PRKind[]; weight: number; reps: number }

/** Personal records from finished sessions' summaries, newest first. */
export async function loadPRs(sb: SB): Promise<PRRow[]> {
  const { data } = await sb.from('workout_sessions').select('date, prs:summary->prs').eq('status', 'done').order('date', { ascending: false });
  return (data ?? []).flatMap((s: any) => ((s.prs ?? []) as Omit<PRRow, 'date'>[]).map((p) => ({ ...p, date: s.date })));
}

export async function loadBlocks(sb: SB): Promise<{ blockNo: number; start: string; end: string | null; status: string }[]> {
  const { data } = await sb.from('mesocycles').select('block_no, start_date, ended_at, status').order('seq');
  return (data ?? []).map((m) => ({ blockNo: m.block_no, start: m.start_date, end: m.ended_at ? String(m.ended_at).slice(0, 10) : null, status: m.status }));
}

export interface PhotoRow { id: string; date: string; angle: Angle; path: string }

/** Every progress photo (no URLs), newest first. */
export async function loadPhotoIndex(sb: SB): Promise<PhotoRow[]> {
  const { data } = await sb.from('progress_photos').select('id, taken_on, angle, storage_path').order('taken_on', { ascending: false });
  return (data ?? []).map((p) => ({ id: p.id, date: p.taken_on, angle: p.angle as Angle, path: p.storage_path }));
}

/** Short-lived signed URLs (≤ 10 min) for just the photos a screen shows. */
export async function signPhotos(sb: SB, rows: readonly PhotoRow[]): Promise<Map<string, string>> {
  if (!rows.length) return new Map();
  const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map((p) => p.path), COACH.photos.signedUrlSeconds);
  const byPath = new Map((data ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  return new Map(rows.filter((p) => byPath.has(p.path)).map((p) => [p.id, byPath.get(p.path)!]));
}

/** Daily food totals since a date. */
export async function loadFoodDays(sb: SB, since: string): Promise<FoodDay[]> {
  const rows = await allRows((from, to) => sb.from('food_logs').select('date, kcal, protein_g').gte('date', since)
    .order('date').order('id').range(from, to));
  const days = new Map<string, FoodDay>();
  for (const r of rows) {
    const d = days.get(r.date) ?? { date: r.date, kcal: 0, protein: 0 };
    d.kcal += Number(r.kcal);
    d.protein += Number(r.protein_g);
    days.set(r.date, d);
  }
  return [...days.values()];
}

/** The nutrition targets in force on a date (the latest set on or before it). */
export async function loadTargetsByDate(sb: SB): Promise<(date: string) => { kcal: number; protein: number } | null> {
  const { data } = await sb.from('nutrition_targets').select('effective_from, kcal, protein_g, created_at')
    .order('effective_from').order('created_at');
  const rows = (data ?? []).map((r) => ({ from: r.effective_from as string, kcal: r.kcal, protein: r.protein_g }));
  return (date) => {
    let hit: (typeof rows)[number] | null = null;
    for (const r of rows) if (r.from <= date) hit = r;
    return hit ? { kcal: hit.kcal, protein: hit.protein } : null;
  };
}
