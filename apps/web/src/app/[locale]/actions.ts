'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { BookSettings, ExportOptions, GLOSSARY_KINDS } from '@bookbridge/core/shared';
import { supabaseServer } from '@/lib/supabase/server';

// All writes run as the signed-in user; RLS decides what is allowed. Inputs are validated here
// so the UI gets clean errors instead of database constraint messages.

async function sbUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error('unauthorized');
  return { sb, user: data.user };
}

const LANG = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);
const optText = (max: number) => z.string().trim().max(max).transform((s) => (s === '' ? null : s));

export async function createBook(locale: string, form: FormData) {
  const { sb, user } = await sbUser();
  const input = z.object({
    title: z.string().trim().min(1).max(300),
    author: optText(300),
    translator_name: optText(300),
    source_lang: LANG,
    target_lang: LANG,
  }).parse(Object.fromEntries(form));
  const { data, error } = await sb.from('books').insert({ ...input, user_id: user.id, settings: BookSettings.parse({}) })
    .select('id').single();
  if (error) throw new Error(error.message);
  redirect(`${locale === 'fa' ? '' : `/${locale}`}/books/${data.id}`);
}

export async function saveSettings(bookId: string, form: FormData) {
  const { sb } = await sbUser();
  const f = Object.fromEntries(form);
  const settings = BookSettings.parse({
    dialogueRegister: f.dialogueRegister,
    persianDigits: f.persianDigits === 'on',
    showLatinNames: f.showLatinNames === 'on',
    translatorNotes: f.translatorNotes === 'on',
    quality: f.quality,
    bodyFont: f.bodyFont,
    fontSizePt: Number(f.fontSizePt),
    pageSize: f.pageSize,
  });
  const meta = z.object({
    title: z.string().trim().min(1).max(300),
    author: optText(300),
    translator_name: optText(300),
    budget_usd: z.string().trim().transform((s) => (s === '' ? null : Number(s))).pipe(z.number().min(0).max(100000).nullable()),
  }).parse(f);
  const { error } = await sb.from('books').update({ ...meta, settings }).eq('id', bookId);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

const Term = z.object({
  source_term: z.string().trim().min(1).max(200),
  target_term: z.string().trim().min(1).max(200),
  kind: z.enum(GLOSSARY_KINDS),
  notes: optText(1000),
  locked: z.boolean(),
});

export async function addTerm(bookId: string, form: FormData) {
  const { sb, user } = await sbUser();
  const t = Term.parse({ ...Object.fromEntries(form), locked: form.get('locked') === 'on' });
  const { error } = await sb.from('glossary_terms').insert({ ...t, book_id: bookId, user_id: user.id, origin: 'user' });
  if (error) throw new Error(error.code === '23505' ? 'This term already exists' : error.message);
  revalidatePath('/', 'layout');
}

export async function updateTerm(termId: string, form: FormData) {
  const { sb } = await sbUser();
  const t = Term.parse({ ...Object.fromEntries(form), locked: form.get('locked') === 'on' });
  const { error } = await sb.from('glossary_terms').update({ ...t, origin: 'user' }).eq('id', termId);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

export async function deleteTerm(termId: string) {
  const { sb } = await sbUser();
  const { error } = await sb.from('glossary_terms').delete().eq('id', termId);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

async function enqueue(sb: Awaited<ReturnType<typeof supabaseServer>>, userId: string, bookId: string, type: string, payload: Record<string, unknown>, dedupeKey?: string) {
  const { error } = await sb.from('jobs').insert({ user_id: userId, book_id: bookId, type, payload, dedupe_key: dedupeKey ?? null });
  // 23505 = an identical job is already queued/running: that's fine.
  if (error && error.code !== '23505') throw new Error(error.message);
}

/** Re-run translation for the book: only blocks whose hash changed (glossary/settings edits) are sent. */
export async function applyGlossary(bookId: string) {
  const { sb, user } = await sbUser();
  const { data: batch } = await sb.from('batches').select('id').eq('book_id', bookId).order('seq', { ascending: false }).limit(1).maybeSingle();
  if (!batch) return;
  await enqueue(sb, user.id, bookId, 'translate_batch', { batchId: batch.id }, `translate_batch:${batch.id}`);
  revalidatePath('/', 'layout');
}

export async function createExport(bookId: string, form: FormData) {
  const { sb, user } = await sbUser();
  const format = z.enum(['pdf', 'epub']).parse(form.get('format'));
  const options = ExportOptions.parse({
    pageSize: form.get('pageSize') || undefined,
    grayscale: form.get('grayscale') === 'on' || undefined,
  });
  const { data, error } = await sb.from('exports')
    .insert({ user_id: user.id, book_id: bookId, format, options, scope: { type: 'book' } }).select('id').single();
  if (error) throw new Error(error.message);
  await enqueue(sb, user.id, bookId, 'render_export', { exportId: data.id }, `render_export:${data.id}`);
  revalidatePath('/', 'layout');
}

export async function resumePaused(bookId: string) {
  const { sb } = await sbUser();
  const { error } = await sb.rpc('resume_paused_jobs', { p_book_id: bookId });
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

export async function setMonthlyBudget(form: FormData) {
  const { sb, user } = await sbUser();
  const raw = String(form.get('monthly_budget_usd') ?? '').trim();
  const value = raw === '' ? null : z.coerce.number().min(0).max(100000).parse(raw);
  const { error } = await sb.from('user_settings').upsert({ user_id: user.id, monthly_budget_usd: value });
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}
