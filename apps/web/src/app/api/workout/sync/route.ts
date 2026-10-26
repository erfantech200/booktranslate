import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { SessionPlan } from '@coach/core/shared';
import { supabaseServer } from '@/lib/supabase/server';

// Gym-mode sync. The phone keeps the session in localStorage and sends what it has whenever it
// can: set logs (client UUIDs → retries are idempotent), deleted sets, and the few plan changes
// made offline (added sets, skipped exercises, note). Swaps go through a server action instead.

export const dynamic = 'force-dynamic';

const SetIn = z.object({
  id: z.string().uuid(),
  slug: z.string().max(80),
  exIdx: z.number().int().min(0).max(60),
  setIdx: z.number().int().min(0).max(60),
  isWarmup: z.boolean(),
  weight: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(600),
  rir: z.number().min(0).max(10).nullable(),
  repMin: z.number().int().min(0).max(600).nullable(),
  repMax: z.number().int().min(0).max(600).nullable(),
  targetRir: z.number().min(0).max(10).nullable(),
  loggedAt: z.string().datetime(),
});
const Body = z.object({
  sessionId: z.string().uuid(),
  sets: z.array(SetIn).max(300).default([]),
  deleted: z.array(z.string().uuid()).max(300).default([]),
  patch: z.object({
    rev: z.number().int().min(0),
    note: z.string().max(1000).nullable().optional(),
    exercises: z.array(z.object({ sets: z.number().int().min(1).max(12), skipped: z.boolean().optional() })).max(60),
  }).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const b = parsed.data;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: session } = await sb.from('workout_sessions').select('id, status, plan, note').eq('id', b.sessionId).maybeSingle();
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (b.sets.length) {
    const { error } = await sb.from('set_logs').upsert(b.sets.map((s) => ({
      id: s.id, user_id: user.id, session_id: b.sessionId, slug: s.slug, ex_idx: s.exIdx, set_idx: s.setIdx, is_warmup: s.isWarmup,
      weight_kg: s.weight, reps: s.reps, rir: s.rir, rep_min: s.repMin, rep_max: s.repMax, target_rir: s.targetRir, logged_at: s.loggedAt,
    })), { onConflict: 'id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (b.deleted.length) await sb.from('set_logs').delete().eq('session_id', b.sessionId).in('id', b.deleted);

  // Plan changes only while the session runs, and never older than what the server has.
  const plan = session.plan as (SessionPlan & { rev?: number }) | null;
  if (b.patch && plan && session.status === 'active' && b.patch.rev > (plan.rev ?? 0)) {
    const exercises = plan.exercises.map((x, i) => {
      const p = b.patch!.exercises[i];
      if (!p) return x;
      const sets = Math.max(1, p.sets);
      const targets = Array.from({ length: sets }, (_, k) => x.targets[k] ?? x.targets.at(-1) ?? x.reps[0]);
      return { ...x, sets, targets, skipped: !!p.skipped };
    });
    await sb.from('workout_sessions').update({
      plan: { ...plan, exercises, rev: b.patch.rev },
      ...(b.patch.note !== undefined ? { note: b.patch.note } : {}),
    }).eq('id', b.sessionId);
  }
  return NextResponse.json({ ok: true, synced: b.sets.map((s) => s.id), deleted: b.deleted });
}
