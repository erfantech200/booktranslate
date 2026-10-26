'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionPlan } from '@coach/core/shared';
import type { GymState, LocalSet } from './types';

// Gym mode keeps the whole session on the phone (localStorage) and syncs in the background, so a
// dead zone in the gym never loses a set. Set ids are UUIDs made here: re-sending is harmless.

const key = (id: string) => `gym:${id}`;

function read(id: string): GymState | null {
  try {
    const raw = localStorage.getItem(key(id));
    const s = raw ? (JSON.parse(raw) as GymState) : null;
    return s?.v === 1 && s.sessionId === id ? s : null;
  } catch {
    return null;
  }
}

export function clearGymState(id: string) {
  try { localStorage.removeItem(key(id)); } catch { /* private mode */ }
}

export function useGymState(init: { sessionId: string; plan: SessionPlan & { rev?: number }; note: string; serverSets: Omit<LocalSet, 'synced'>[] }) {
  const [s, setS] = useState<GymState>(() => ({
    v: 1, sessionId: init.sessionId, plan: init.plan, rev: init.plan.rev ?? 0, patchDirty: false, note: init.note,
    sets: init.serverSets.map((x) => ({ ...x, synced: true })), deleted: [], cursor: 0, timer: null,
  }));
  const [online, setOnline] = useState(true);
  const [ready, setReady] = useState(false);
  const syncing = useRef(false);
  const latest = useRef(s);
  latest.current = s;

  // Restore after mount (localStorage is client-only); keep server sets the phone doesn't have.
  useEffect(() => {
    const saved = read(init.sessionId);
    if (saved) {
      const have = new Set(saved.sets.map((x) => x.id));
      const extra = init.serverSets.filter((x) => !have.has(x.id) && !saved.deleted.includes(x.id)).map((x) => ({ ...x, synced: true }));
      // A swap made on the server (another device) wins over a stale local exercise list.
      const plan = saved.plan.exercises.length === init.plan.exercises.length ? saved.plan : init.plan;
      setS({ ...saved, plan, sets: [...saved.sets, ...extra] });
    }
    setOnline(navigator.onLine);
    setReady(true);
  }, [init.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key(s.sessionId), JSON.stringify(s)); } catch { /* storage full or blocked */ }
  }, [s, ready]);

  const flush = useCallback(async (): Promise<boolean> => {
    const cur = latest.current;
    const sets = cur.sets.filter((x) => !x.synced);
    if (!sets.length && !cur.deleted.length && !cur.patchDirty) return true;
    if (syncing.current) return false;
    syncing.current = true;
    try {
      const res = await fetch('/api/workout/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: cur.sessionId,
          sets: sets.map(({ synced: _s, ...x }) => x),
          deleted: cur.deleted,
          patch: cur.patchDirty ? { rev: cur.rev, note: cur.note || null, exercises: cur.plan.exercises.map((x) => ({ sets: x.sets, skipped: !!x.skipped })) } : undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const ok = new Set(sets.map((x) => x.id));
      const gone = new Set(cur.deleted);
      setS((p) => ({
        ...p,
        sets: p.sets.map((x) => (ok.has(x.id) ? { ...x, synced: true } : x)),
        deleted: p.deleted.filter((id) => !gone.has(id)),
        patchDirty: p.rev === cur.rev ? false : p.patchDirty,
      }));
      setOnline(true);
      return true;
    } catch {
      setOnline(navigator.onLine);
      return false;
    } finally {
      syncing.current = false;
    }
  }, []);

  // Sync shortly after every change, when the connection comes back, and every 15 s while pending.
  const pending = s.sets.filter((x) => !x.synced).length + s.deleted.length + (s.patchDirty ? 1 : 0);
  useEffect(() => {
    if (!ready || !pending) return;
    const t = setTimeout(() => void flush(), 400);
    const i = setInterval(() => void flush(), 15_000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [ready, pending, flush]);
  useEffect(() => {
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [flush]);

  return { s, setS, flush, online, ready, unsynced: s.sets.filter((x) => !x.synced).length };
}
