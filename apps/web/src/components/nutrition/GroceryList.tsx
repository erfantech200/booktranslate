'use client';

import { useEffect, useState } from 'react';

/** Grocery checklist; ticks live on this phone only (localStorage), per week. */
export function GroceryList({ week, groups }: { week: string; groups: { title: string; lines: { id: string; name: string; amount: string }[] }[] }) {
  const key = `grocery:${week}`;
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { /* blocked */ } }, [key]);
  const toggle = (id: string) => setDone((d) => {
    const next = d.includes(id) ? d.filter((x) => x !== id) : [...d, id];
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* blocked */ }
    return next;
  });
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.title} className="card">
          <h2 className="card-title">{g.title}</h2>
          <ul className="mt-2 divide-y divide-line">
            {g.lines.map((l) => (
              <li key={l.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
                  <input type="checkbox" className="h-5 w-5" checked={done.includes(l.id)} onChange={() => toggle(l.id)} />
                  <span className={`flex-1 ${done.includes(l.id) ? 'text-muted line-through' : ''}`}>{l.name}</span>
                  <span className="num text-sm text-muted">{l.amount}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
