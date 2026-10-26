'use client';

import { latinDigits } from '@/lib/digits';
import { fmtNum, type Digits } from '@/lib/format';

/** Big − value + control for the gym: thumb-sized buttons, the number typed directly if needed. */
export function Stepper({ label, value, onChange, step, min = 0, max = 1000, digits, unit, id }: {
  label: string; value: number; onChange: (v: number) => void; step: number; min?: number; max?: number; digits: Digits; unit?: string; id: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-center text-xs text-muted">{label}{unit ? ` (${unit})` : ''}</label>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-surface-2" dir="ltr">
        <button type="button" className="w-11 shrink-0 text-2xl font-bold text-muted active:bg-line" aria-label={`${label} −`}
          onClick={() => onChange(clamp(value - step))}>−</button>
        <input id={id} inputMode="decimal" className="num min-w-0 flex-1 bg-transparent py-2.5 text-center text-xl font-extrabold text-fg focus:outline-none"
          value={fmtNum(value, digits, { maximumFractionDigits: 2, useGrouping: false })}
          onChange={(e) => { const n = Number(latinDigits(e.target.value)); if (Number.isFinite(n)) onChange(clamp(n)); }}
          onFocus={(e) => e.target.select()} />
        <button type="button" className="w-11 shrink-0 text-2xl font-bold text-muted active:bg-line" aria-label={`${label} +`}
          onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}
