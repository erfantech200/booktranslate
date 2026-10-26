import { EXERCISES } from './data/exercises';
import { videoSearchUrl, type Exercise } from './engine/library';
import { hashOf } from './hash';
import { query, type Queryable, getPool } from './db/pool';

// Syncs the reviewed seed (src/data/exercises) into the `exercises` table. Runs after migrations
// (CLI and /api/admin/migrate). Only rows whose content changed are written; AI-written rows
// (source = 'ai') are never touched. Image fields are left alone.

export const seedHash = (e: Exercise) => hashOf(e);

export function exerciseRow(e: Exercise) {
  return {
    slug: e.slug,
    name_en: e.nameEn,
    name_fa: e.nameFa,
    movement_pattern: e.pattern,
    primary_muscles: e.primary,
    secondary_muscles: e.secondary,
    equipment: JSON.stringify(e.equipment),
    difficulty: e.difficulty,
    unilateral: e.unilateral,
    compound: e.compound,
    timed: e.timed,
    load_type: e.loadType,
    region: e.region,
    rank: e.rank,
    rep_min: e.reps[0],
    rep_max: e.reps[1],
    default_rest_sec: e.restSec,
    setup_steps: e.setup,
    execution_steps: e.execution,
    form_cues: e.cues,
    common_mistakes: JSON.stringify(e.mistakes),
    breathing: e.breathing,
    tempo: e.tempo,
    safety_notes: e.safety,
    contraindications: e.contraindications,
    cautions: e.cautions,
    regressions: e.regressions,
    progressions: e.progressions,
    substitutes: e.substitutes,
    video_search_url: videoSearchUrl(e),
    source: 'seed',
    content_hash: seedHash(e),
  };
}

export interface SeedStatus { total: number; missing: string[]; changed: string[] }

export async function exerciseSeedStatus(db: Queryable = getPool()): Promise<SeedStatus> {
  const rows = await query<{ slug: string; content_hash: string }>(`select slug, content_hash from public.exercises where source = 'seed'`, [], db);
  const have = new Map(rows.map((r) => [r.slug, r.content_hash]));
  return {
    total: EXERCISES.length,
    missing: EXERCISES.filter((e) => !have.has(e.slug)).map((e) => e.slug),
    changed: EXERCISES.filter((e) => have.has(e.slug) && have.get(e.slug) !== seedHash(e)).map((e) => e.slug),
  };
}

export async function syncExercises(db: Queryable = getPool()): Promise<{ written: string[] }> {
  const s = await exerciseSeedStatus(db);
  const todo = new Set([...s.missing, ...s.changed]);
  const written: string[] = [];
  for (const e of EXERCISES) {
    if (!todo.has(e.slug)) continue;
    const row = exerciseRow(e);
    const cols = Object.keys(row);
    const placeholders = cols.map((c, i) => (c === 'equipment' || c === 'common_mistakes' ? `$${i + 1}::jsonb` : `$${i + 1}`));
    const updates = cols.filter((c) => c !== 'slug').map((c) => `${c} = excluded.${c}`);
    await query(
      `insert into public.exercises (${cols.join(', ')}) values (${placeholders.join(', ')})
       on conflict (slug) do update set ${updates.join(', ')} where public.exercises.source = 'seed'`,
      Object.values(row),
      db,
    );
    written.push(e.slug);
  }
  return { written };
}
