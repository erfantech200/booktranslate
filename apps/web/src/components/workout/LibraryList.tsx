'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { fmtNum, type Digits } from '@/lib/format';

export interface LibraryItem { slug: string; nameFa: string; nameEn: string; pattern: string; primary: string[]; excluded: boolean; inProgram: boolean }

const GROUPS: Record<string, string[]> = {
  lower: ['squat', 'hinge', 'lunge', 'glute', 'quad_iso', 'hamstring_iso', 'calves'],
  push: ['horizontal_push', 'vertical_push', 'chest_fly', 'lateral_delt', 'triceps'],
  pull: ['horizontal_pull', 'vertical_pull', 'rear_delt', 'biceps', 'traps'],
  core: ['core'],
};

export function LibraryList({ items, digits }: { items: LibraryItem[]; digits: Digits }) {
  const t = useTranslations('library');
  const tw = useTranslations('workout');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((e) => (group === 'all' || GROUPS[group]!.includes(e.pattern))
      && (!needle || e.nameFa.includes(needle) || e.nameEn.toLowerCase().includes(needle)));
  }, [items, q, group]);
  const order = Object.values(GROUPS).flat();
  const patterns = [...new Set(shown.map((e) => e.pattern))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const groupLabel = (g: string) => (g === 'all' ? t('all') : g === 'lower' ? tw('days.legs') : g === 'push' ? tw('days.push') : g === 'pull' ? tw('days.pull') : tw('pattern.core'));
  return (
    <div className="space-y-4">
      <input type="search" className="input" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="group">
        {['all', ...Object.keys(GROUPS)].map((g) => (
          <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}
            className={`chip shrink-0 ${group === g ? 'border-accent bg-accent-soft text-accent-text' : ''}`}>{groupLabel(g)}</button>
        ))}
      </div>
      <p className="text-sm text-muted" aria-live="polite">{t('count', { n: fmtNum(shown.length, digits) })}</p>
      {shown.length === 0 && <p className="card text-muted">{t('empty')}</p>}
      {patterns.map((p) => (
        <section key={p}>
          <h2 className="mb-2 text-sm font-bold text-muted">{tw(`pattern.${p}`)}</h2>
          <ul className="card divide-y divide-line p-0 sm:p-0">
            {shown.filter((e) => e.pattern === p).map((e) => (
              <li key={e.slug}>
                <Link href={`/workout/library/${e.slug}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <b className="block">{e.nameFa}</b>
                    <span className="block truncate text-xs text-muted">{e.primary.map((m) => tw(`muscle.${m}`)).join('، ')}</span>
                  </span>
                  {e.excluded && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">{t('excluded')}</span>}
                  {e.inProgram && !e.excluded && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-text">{t('inProgram')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
