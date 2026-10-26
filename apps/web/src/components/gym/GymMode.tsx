'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { addToBests, detectPRs, type PlannedExercise, type PRKind, type SessionPlan } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { fmtNum, type Digits } from '@/lib/format';
import { discardWorkout, finishWorkout, type PainResult } from '@/lib/workoutActions';
import { PainSheet } from './PainSheet';
import { mmss, RestTimer, unlockAudio } from './RestTimer';
import { Stepper } from './Stepper';
import { SwapSheet } from './SwapSheet';
import type { GymExercise, LocalSet } from './types';
import { clearGymState, useGymState } from './useGymState';

interface Props {
  sessionId: string;
  startedAt: string;
  plan: SessionPlan & { rev?: number };
  note: string;
  serverSets: Omit<LocalSet, 'synced'>[];
  exercises: Record<string, GymExercise>;
  dayName: string;
  digits: Digits;
}

const RIRS = [0, 1, 2, 3, 4, 5];
const noLoad = (e: PlannedExercise, info?: GymExercise) => e.timed || info?.loadType === 'band';

export function GymMode(p: Props) {
  const t = useTranslations('gym');
  const tw = useTranslations('workout');
  const tPain = useTranslations('pain');
  const d = p.digits;
  const nf = (n: number, o?: Intl.NumberFormatOptions) => fmtNum(n, d, o);
  const { s, setS, flush, online, unsynced } = useGymState({ sessionId: p.sessionId, plan: p.plan, note: p.note, serverSets: p.serverSets });
  const [sheet, setSheet] = useState<'pain' | 'swap' | null>(null);
  const [pr, setPr] = useState<{ name: string; kinds: PRKind[] } | null>(null);
  const [redFlag, setRedFlag] = useState(false);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);
  const [finishing, startFinish] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  // Exercises swapped in during the session (the page only sent the planned ones).
  const [extra, setExtra] = useState<Record<string, GymExercise>>({});
  const infoOf = (slug: string) => p.exercises[slug] ?? extra[slug];

  const cursor = Math.min(s.cursor, s.plan.exercises.length - 1);
  const ex = s.plan.exercises[cursor]!;
  const info = infoOf(ex.slug);
  const name = info?.nameFa ?? ex.slug;
  const setsOf = (i: number, warm: boolean) => s.sets.filter((x) => x.exIdx === i && x.isWarmup === warm).sort((a, b) => a.setIdx - b.setIdx);
  const work = setsOf(cursor, false);
  const warm = setsOf(cursor, true);
  const doneEx = (i: number) => !!s.plan.exercises[i]!.skipped || setsOf(i, false).length >= s.plan.exercises[i]!.sets;
  const allDone = s.plan.exercises.every((_, i) => doneEx(i));

  // ─── Draft for the next set: pre-filled with the target so one tap confirms ────────────
  const defaults = useCallback(() => {
    const prev = work.at(-1);
    const weight = prev?.weight ?? ex.load ?? ex.last?.sets[0]?.weight ?? (info?.loadType === 'barbell' ? 20 : 0);
    const reps = ex.targets[work.length] ?? ex.targets.at(-1) ?? ex.reps[0];
    return { weight, reps, rir: Math.round(ex.rir) };
  }, [ex, work, info]);
  const [draft, setDraft] = useState(defaults);
  const draftKey = `${cursor}:${work.length}:${ex.slug}`;
  useEffect(() => setDraft(defaults()), [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Screen stays on during the workout (re-acquired when the page comes back).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const get = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not allowed */ } };
    const vis = () => { if (document.visibilityState === 'visible') void get(); };
    void get();
    document.addEventListener('visibilitychange', vis);
    const i = setInterval(() => setNow(Date.now()), 20_000);
    return () => { document.removeEventListener('visibilitychange', vis); clearInterval(i); void lock?.release().catch(() => {}); };
  }, []);

  const go = (i: number) => setS((x) => ({ ...x, cursor: Math.max(0, Math.min(x.plan.exercises.length - 1, i)) }));
  const nextOpen = (from: number) => {
    for (let k = 1; k <= s.plan.exercises.length; k++) {
      const i = (from + k) % s.plan.exercises.length;
      if (!doneEx(i)) return i;
    }
    return from;
  };
  const patchPlan = (fn: (e: PlannedExercise) => PlannedExercise, i = cursor) =>
    setS((x) => ({ ...x, rev: x.rev + 1, patchDirty: true, plan: { ...x.plan, exercises: x.plan.exercises.map((e, k) => (k === i ? fn(e) : e)) } }));

  function log(set: { weight: number; reps: number; rir: number | null }, isWarmup: boolean, setIdx: number) {
    unlockAudio();
    navigator.vibrate?.(25);
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
    const row: LocalSet = {
      id: crypto.randomUUID(), slug: ex.slug, exIdx: cursor, setIdx, isWarmup, weight: set.weight, reps: set.reps, rir: set.rir,
      repMin: ex.reps[0], repMax: ex.reps[1], targetRir: ex.rir, loggedAt: new Date().toISOString(), synced: false,
    };
    if (!isWarmup) {
      // PR against everything before this set: history + this session's earlier sets.
      const before = s.sets.filter((x) => x.slug === ex.slug && !x.isWarmup).reduce((b, x) => addToBests(b, x), ex.bests);
      const kinds = detectPRs(row, before);
      if (kinds.length) {
        setPr({ name, kinds });
        navigator.vibrate?.([40, 60, 40, 60, 120]);
        setTimeout(() => setPr(null), 3800);
      }
    }
    const lastOfSession = !isWarmup && work.length + 1 >= ex.sets && s.plan.exercises.every((_, i) => i === cursor || doneEx(i));
    setS((x) => ({
      ...x,
      sets: [...x.sets, row],
      timer: isWarmup || lastOfSession ? x.timer : { endsAt: Date.now() + ex.restSec * 1000, total: ex.restSec, exIdx: cursor },
    }));
  }

  function remove(id: string) {
    setS((x) => {
      const row = x.sets.find((r) => r.id === id);
      return { ...x, sets: x.sets.filter((r) => r.id !== id), deleted: row?.synced ? [...x.deleted, id] : x.deleted };
    });
  }

  function onPain(r: PainResult) {
    if (r.redFlag) setRedFlag(true);
    if (r.stop) patchPlan((e) => ({ ...e, skipped: true }));
  }

  async function finish() {
    if (!window.confirm(t('finishConfirm'))) return;
    setFinishMsg(null);
    const ok = await flush();
    if (!ok || s.sets.some((x) => !x.synced)) {
      // flush() updates state asynchronously; one more try picks up the final state.
      if (!(await flush())) { setFinishMsg(t('finishPending')); return; }
    }
    startFinish(async () => {
      clearGymState(p.sessionId);
      await finishWorkout(p.sessionId);
    });
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(p.startedAt)) / 60_000));
  const nextIdx = nextOpen(cursor);
  const timerNext = s.timer ? (doneEx(s.timer.exIdx) ? infoOf(s.plan.exercises[nextIdx]!.slug)?.nameFa : infoOf(s.plan.exercises[s.timer.exIdx]!.slug)?.nameFa) ?? '' : '';
  const lastLine = useMemo(() => {
    const xs = ex.last?.sets ?? [];
    if (!xs.length) return null;
    const same = xs.every((x) => x.weight === xs[0]!.weight);
    if (ex.timed) return xs.map((x) => nf(x.reps)).join('، ') + ` ${t('seconds')}`;
    return same ? `${nf(xs[0]!.weight)} ${t('kg')} × ${xs.map((x) => nf(x.reps)).join('، ')}` : xs.map((x) => `${nf(x.weight)}×${nf(x.reps)}`).join('، ');
  }, [ex]); // eslint-disable-line react-hooks/exhaustive-deps

  const decisionText = (() => {
    if (ex.decision === 'increase' && ex.load != null && ex.from != null) return t('decision.increase', { delta: nf(ex.load - ex.from) });
    if (ex.decision === 'reduce' && ex.load != null && ex.from) return t('decision.reduce', { pct: nf(Math.round((1 - ex.load / ex.from) * 100)) });
    if (ex.decision === 'hold' && !ex.last) return null;
    return t(`decision.${ex.decision}`);
  })();

  return (
    <div className={`mx-auto min-h-dvh max-w-xl px-4 ${s.timer ? 'pb-40' : 'pb-10'}`}>
      {/* ─── Top bar ─── */}
      <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/95 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/workout" className="btn btn-ghost -ms-3 px-3" aria-label={t('exit')}>✕</Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{p.dayName}</p>
            <p className="num text-xs text-muted">{t('elapsed')}: {t('elapsedMin', { n: nf(elapsed) })} · {t('exercise', { n: nf(cursor + 1), total: nf(s.plan.exercises.length) })}</p>
          </div>
          <button type="button" className="btn btn-primary min-h-10 px-4" onClick={finish} disabled={finishing}>{t('finish')}</button>
        </div>
        <nav className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4" aria-label={t('title')}>
          {s.plan.exercises.map((e, i) => (
            <button key={`${i}-${e.slug}`} type="button" onClick={() => go(i)} aria-current={i === cursor ? 'step' : undefined}
              aria-label={infoOf(e.slug)?.nameFa ?? e.slug}
              className={`num grid h-9 min-w-9 shrink-0 place-items-center rounded-full border text-sm font-bold transition-colors ${
                i === cursor ? 'border-accent bg-accent text-accent-fg'
                  : e.skipped ? 'border-line text-muted line-through'
                  : doneEx(i) ? 'border-ok/50 bg-ok-soft text-ok' : 'border-line bg-surface-2 text-fg'}`}>
              {nf(i + 1)}
            </button>
          ))}
        </nav>
        {(!online || unsynced > 0) && (
          <p className="mt-2 text-xs text-muted" role="status">{!online ? t('offline') : t('unsynced', { n: nf(unsynced) })}</p>
        )}
      </header>

      {redFlag && <p role="alert" className="note note-danger mt-4 font-bold">{tPain('redFlagStop')}</p>}
      {cursor === 0 && warm.length === 0 && work.length === 0 && (
        <p className="note note-info mt-4">{t('generalWarmup')}</p>
      )}
      {(s.plan.deload || s.plan.technique) && cursor === 0 && (
        <p className="note note-ok mt-3">{s.plan.deload ? t('deloadNote') : t('techniqueNote')}</p>
      )}

      {/* ─── Current exercise ─── */}
      <section key={`${cursor}-${ex.slug}`} className="rise mt-4" aria-labelledby="ex-h">
        <p className="text-xs font-bold text-accent-text">{tw(`role.${ex.role}`)}{ex.swappedFrom ? ` · ${t('swap')}` : ''}</p>
        <h1 id="ex-h" className="mt-0.5 text-[1.625rem] font-extrabold leading-tight">{name}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="num rounded-lg bg-surface-2 px-2.5 py-1 font-bold" dir="ltr">{nf(ex.sets)} × {nf(ex.reps[0])}–{nf(ex.reps[1])}{ex.timed ? ` ${t('seconds')}` : ''}</span>
          <span className="num rounded-lg bg-surface-2 px-2.5 py-1">{t('rirShort')} {nf(ex.rir)}</span>
          {!noLoad(ex, info) && ex.load != null && <span className="num rounded-lg bg-accent-soft px-2.5 py-1 font-bold text-accent-text">{nf(ex.load)} {t('kg')}</span>}
          <span className="num rounded-lg bg-surface-2 px-2.5 py-1 text-muted">{t('rest')} <span dir="ltr">{mmss(ex.restSec, d)}</span></span>
        </div>
        {decisionText && <p className="mt-3 text-[0.9375rem] text-muted">{decisionText}</p>}
        <p className="mt-1 text-sm text-muted">
          {t('lastTime')}: <span className="num text-fg">{lastLine ?? t('firstTime')}</span>
        </p>
        {ex.caution && <p role="note" className="note note-warn mt-3">{t('caution')}</p>}

        {ex.skipped ? (
          <div className="card mt-4 text-center">
            <p className="text-muted">{t('skipped')}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setSheet('swap')}>{t('swap')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => patchPlan((e) => ({ ...e, skipped: false }))}>{t('unskip')}</button>
            </div>
          </div>
        ) : (
          <>
            {/* Warm-up ramp */}
            {ex.warmups.length > 0 && (
              <div className="mt-4">
                <h2 className="text-sm font-bold text-muted">{t('warmup')}</h2>
                <ul className="mt-2 space-y-1.5">
                  {ex.warmups.map((w, i) => {
                    const doneW = warm.find((x) => x.setIdx === i);
                    return (
                      <li key={i} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${doneW ? 'border-ok/40 bg-ok-soft' : 'border-line'}`}>
                        <span className="num flex-1">
                          {w.weight != null ? `${nf(w.weight)} ${t('kg')} × ${nf(w.reps)}` : `${t('warmupOf', { pct: nf(Math.round(w.fraction * 100)) })} × ${nf(w.reps)}`}
                        </span>
                        {doneW ? (
                          <button type="button" className="text-sm text-muted" onClick={() => remove(doneW.id)}>{t('undo')}</button>
                        ) : (
                          <button type="button" className="btn btn-secondary min-h-9 px-3 text-sm" onClick={() => log({ weight: w.weight ?? 0, reps: w.reps, rir: null }, true, i)}>✓</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Working sets */}
            <ol className="mt-4 space-y-2">
              {work.map((x, i) => (
                <li key={x.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-ok-soft text-xs font-bold text-ok">{nf(i + 1)}</span>
                  <span className="num flex-1 font-bold">
                    {noLoad(ex, info) ? '' : `${nf(x.weight)} ${t('kg')} × `}{nf(x.reps)}{ex.timed ? ` ${t('seconds')}` : ''}
                    {x.rir != null && <span className="ms-2 font-normal text-muted">{t('rirShort')} {nf(x.rir)}</span>}
                  </span>
                  {!x.synced && <span className="h-2 w-2 rounded-full bg-accent" title={t('unsynced', { n: nf(1) })} />}
                  {i === work.length - 1 && <button type="button" className="text-sm text-muted" onClick={() => remove(x.id)}>{t('undo')}</button>}
                </li>
              ))}
            </ol>

            {work.length < ex.sets ? (
              <div className="card mt-3 border-accent/50">
                <p className="mb-3 text-sm font-bold">{t('set', { n: nf(work.length + 1) })} <span className="font-normal text-muted">/ {nf(ex.sets)}</span></p>
                <div className="flex gap-2">
                  {!noLoad(ex, info) && (
                    <Stepper id="w" label={info?.loadType === 'bodyweight' ? t('addedLoad') : t('weight')} unit={t('kg')} digits={d}
                      value={draft.weight} step={ex.increment || 2.5} onChange={(v) => setDraft((x) => ({ ...x, weight: v }))} />
                  )}
                  <Stepper id="r" label={ex.timed ? t('seconds') : t('reps')} digits={d} value={draft.reps} step={ex.timed ? 5 : 1} min={0} max={600}
                    onChange={(v) => setDraft((x) => ({ ...x, reps: Math.round(v) }))} />
                </div>
                <fieldset className="mt-3">
                  <legend className="mb-1 text-xs text-muted">{t('rir')} <span className="sr-only">{t('rirHelp')}</span></legend>
                  <div className="grid grid-cols-6 gap-1.5" dir="ltr">
                    {RIRS.map((r) => (
                      <button key={r} type="button" aria-pressed={draft.rir === r} onClick={() => setDraft((x) => ({ ...x, rir: r }))}
                        className={`num min-h-11 rounded-xl border text-base font-bold ${draft.rir === r ? 'border-accent bg-accent-soft text-accent-text' : 'border-line bg-surface-2 text-muted'}`}>
                        {r === 5 ? `${nf(5)}+` : nf(r)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('rirHelp')}</p>
                </fieldset>
                <button type="button" className="btn btn-primary mt-4 w-full text-lg" onClick={() => log({ weight: noLoad(ex, info) ? 0 : draft.weight, reps: draft.reps, rir: draft.rir }, false, work.length)}>
                  {t('log')} ✓
                </button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {nextIdx !== cursor && <button type="button" className="btn btn-primary flex-1" onClick={() => go(nextIdx)}>{t('next')}</button>}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
          <button type="button" className="btn btn-secondary min-h-11 px-2" onClick={() => setSheet('swap')}>{t('swap')}</button>
          <button type="button" className="btn btn-secondary min-h-11 px-2" onClick={() => patchPlan((e) => ({ ...e, sets: e.sets + 1, targets: [...e.targets, e.targets.at(-1) ?? e.reps[0]] }))}>{t('addSet')}</button>
          <button type="button" className="btn btn-secondary min-h-11 px-2" onClick={() => { patchPlan((e) => ({ ...e, skipped: !e.skipped })); if (!ex.skipped) go(nextOpen(cursor)); }}>
            {ex.skipped ? t('unskip') : t('skip')}
          </button>
          <button type="button" className="btn btn-secondary min-h-11 px-2 text-danger" onClick={() => setSheet('pain')}>{t('pain')}</button>
        </div>

        {info && (
          <details className="card mt-4">
            <summary className="cursor-pointer font-bold">{t('cues')}</summary>
            <ul className="mt-2 list-disc space-y-1 ps-5">{info.cues.map((c) => <li key={c}>{c}</li>)}</ul>
            <h3 className="mt-3 text-sm font-bold text-muted">{t('howTo')}</h3>
            <ol className="mt-1 list-decimal space-y-1 ps-5 text-[0.9375rem]">{[...info.setup, ...info.execution].map((c) => <li key={c}>{c}</li>)}</ol>
            <Link href={`/workout/library/${ex.slug}`} className="mt-3 inline-block text-sm text-accent-text">{tw('library')}</Link>
          </details>
        )}

        <div className="mt-4 flex justify-between gap-2">
          <button type="button" className="btn btn-ghost" disabled={cursor === 0} onClick={() => go(cursor - 1)}>{t('prev')}</button>
          <button type="button" className="btn btn-ghost" disabled={cursor === s.plan.exercises.length - 1} onClick={() => go(cursor + 1)}>{t('next')}</button>
        </div>
      </section>

      {allDone && (
        <div className="card mt-4 border-ok/50 text-center">
          <p className="font-bold text-ok">{t('done')}</p>
          <button type="button" className="btn btn-primary mt-3 w-full" onClick={finish} disabled={finishing}>{t('finish')}</button>
        </div>
      )}
      {finishMsg && <p role="alert" className="note note-danger mt-4">{finishMsg}</p>}

      <label className="field mt-6">
        <span className="field-label">{t('note')}</span>
        <textarea className="input" placeholder={t('notePlaceholder')} value={s.note} maxLength={1000}
          onChange={(e) => setS((x) => ({ ...x, note: e.target.value }))} onBlur={() => setS((x) => ({ ...x, rev: x.rev + 1, patchDirty: true }))} />
      </label>
      <form action={discardWorkout.bind(null, p.sessionId)} className="mt-6 text-center"
        onSubmit={(e) => { if (!window.confirm(t('discardConfirm'))) e.preventDefault(); else clearGymState(p.sessionId); }}>
        <button className="btn btn-ghost text-sm text-danger">{t('discard')}</button>
      </form>

      {s.timer && (
        <RestTimer endsAt={s.timer.endsAt} total={s.timer.total} nextName={timerNext} digits={d}
          onAdd={() => setS((x) => (x.timer ? { ...x, timer: { ...x.timer, endsAt: x.timer.endsAt + 30_000, total: x.timer.total + 30 } } : x))}
          onSkip={() => setS((x) => ({ ...x, timer: null }))}
          onDone={() => setS((x) => ({ ...x, timer: null, cursor: doneEx(x.timer?.exIdx ?? x.cursor) ? nextOpen(x.timer?.exIdx ?? x.cursor) : x.cursor }))} />
      )}

      {pr && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center px-4">
          <div className="pr-pop relative rounded-2xl border border-accent bg-surface px-5 py-4 text-center shadow-2xl">
            <span className="pr-ring" aria-hidden="true" />
            <p className="text-2xl font-extrabold text-accent-text">{t('pr')}</p>
            <p className="mt-0.5 font-bold">{pr.name}</p>
            <p className="mt-1 text-sm text-muted">{pr.kinds.map((k) => t(`prKind.${k}`)).join(' · ')}</p>
          </div>
        </div>
      )}

      <PainSheet open={sheet === 'pain'} onClose={() => setSheet(null)} sessionId={p.sessionId} slug={ex.slug} digits={d} onResult={onPain} />
      <SwapSheet open={sheet === 'swap'} onClose={() => setSheet(null)} sessionId={p.sessionId} exIdx={cursor} slug={ex.slug} name={name}
        onSwapped={({ planned, info: gi }) => {
          setExtra((m) => ({ ...m, [gi.slug]: gi }));
          setS((st) => ({ ...st, plan: { ...st.plan, exercises: st.plan.exercises.map((e, i) => (i === cursor ? planned : e)) } }));
        }} />
    </div>
  );
}
