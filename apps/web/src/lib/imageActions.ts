'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@coach/core';
import { kickWorker } from './kick';
import { requireProfile } from './profile';

// Exercise illustrations: "image is wrong" hides it (the written cues stay primary, spec §7), and
// a batch job draws every missing one. The shared exercises table is written through the core pool.

export async function flagExerciseImage(slug: string) {
  await requireProfile();
  await query(`update public.exercises set image_status = 'flagged' where slug = $1`, [slug]);
  revalidatePath('/workout/library', 'layout');
}

export async function startExerciseImages() {
  const { sb, user } = await requireProfile();
  await sb.from('jobs').insert({ user_id: user.id, type: 'exercise_images', payload: {}, dedupe_key: `exercise_images:${user.id}` });
  await kickWorker();
  revalidatePath('/settings');
}
