import 'server-only';
import { addDays, isTrainingDate, streak } from '@coach/core/shared';
import type { supabaseServer } from './supabase/server';
import { loadActiveMeso } from './training';

type SB = Awaited<ReturnType<typeof supabaseServer>>;

/** Training-or-rest for each date (null without a block), creatine ticks and the current streak. */
export async function loadSupplementDays(sb: SB, dates: readonly string[], today: string) {
  const from = [...dates, today].sort()[0]!;
  const [block, { data: logs }, { data: sessions }] = await Promise.all([
    loadActiveMeso(sb),
    sb.from('supplement_logs').select('date').eq('kind', 'creatine').gte('date', addDays(today, -400)).order('date'),
    sb.from('workout_sessions').select('date, status').gte('date', from),
  ]);
  const taken = new Set((logs ?? []).map((l) => l.date as string));
  const training = new Map(dates.map((date) => [date, block
    ? isTrainingDate({ date, today, trainingWeekdays: block.meso.trainingDays, sessions: (sessions ?? []) as { date: string; status: 'active' | 'done' | 'skipped' }[] })
    : null]));
  return { training, taken, streak: streak([...taken], today) };
}
