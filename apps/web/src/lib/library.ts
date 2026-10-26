import 'server-only';
import { cache } from 'react';
import type { Exercise } from '@coach/core/shared';
import { supabaseServer } from './supabase/server';

export interface LibraryExercise extends Exercise {
  imageUrl: string | null;
  imageStatus: 'pending' | 'ok' | 'flagged';
  videoSearchUrl: string;
}

type Row = Record<string, any>;
const toExercise = (r: Row): LibraryExercise => ({
  slug: r.slug,
  nameEn: r.name_en,
  nameFa: r.name_fa,
  pattern: r.movement_pattern,
  primary: r.primary_muscles,
  secondary: r.secondary_muscles,
  equipment: r.equipment,
  difficulty: r.difficulty,
  unilateral: r.unilateral,
  compound: r.compound,
  timed: r.timed,
  loadType: r.load_type,
  region: r.region,
  rank: r.rank,
  reps: [r.rep_min, r.rep_max],
  restSec: r.default_rest_sec,
  setup: r.setup_steps,
  execution: r.execution_steps,
  cues: r.form_cues,
  mistakes: r.common_mistakes,
  breathing: r.breathing,
  tempo: r.tempo,
  safety: r.safety_notes,
  contraindications: r.contraindications,
  cautions: r.cautions,
  regressions: r.regressions,
  progressions: r.progressions,
  substitutes: r.substitutes,
  imageUrl: r.image_url,
  imageStatus: r.image_status,
  videoSearchUrl: r.video_search_url,
});

/** The exercise library (≈80 small rows), read once per request. */
export const loadLibrary = cache(async (): Promise<LibraryExercise[]> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.from('exercises').select('*').order('movement_pattern').order('rank');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toExercise);
});

export const librarySlugMap = async () => new Map((await loadLibrary()).map((e) => [e.slug, e]));
