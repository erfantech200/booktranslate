import { fmtNum, type Digits } from '@/lib/format';

interface Ring { value: number; target: number }

function Arc({ r, frac, color, width }: { r: number; frac: number; color: string; width: number }) {
  const c = 2 * Math.PI * r;
  return (
    <>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth={width} />
      {frac > 0 && (
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
          strokeDasharray={`${Math.min(1, frac) * c} ${c}`} transform="rotate(-90 60 60)" className="transition-[stroke-dasharray] duration-700" />
      )}
    </>
  );
}

/** Today's energy (outer ring) and protein (inner ring) against target, values labelled directly. */
export function Rings({ kcal, protein, digits, labels }: {
  kcal: Ring; protein: Ring; digits: Digits;
  labels: { kcal: string; protein: string; g: string; of: (t: string) => string; left: (n: string) => string; over: (n: string) => string };
}) {
  const nf = (n: number) => fmtNum(Math.round(n), digits);
  const rest = (r: Ring, unit = '') => (r.value <= r.target ? labels.left(`${nf(r.target - r.value)}${unit}`) : labels.over(`${nf(r.value - r.target)}${unit}`));
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img"
        aria-label={`${labels.kcal} ${nf(kcal.value)} ${labels.of(nf(kcal.target))}، ${labels.protein} ${nf(protein.value)} ${labels.of(nf(protein.target))}`}>
        <Arc r={52} frac={kcal.value / kcal.target} color="var(--accent)" width={11} />
        <Arc r={37} frac={protein.value / protein.target} color="var(--chart-plan)" width={11} />
        <text x="60" y="58" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--fg)" className="num">{nf(kcal.value)}</text>
        <text x="60" y="74" textAnchor="middle" fontSize="9.5" fill="var(--muted)" className="num">{labels.of(nf(kcal.target))}</text>
      </svg>
      <dl className="min-w-0 flex-1 space-y-3">
        <div>
          <dt className="flex items-center gap-1.5 text-sm text-muted"><span className="h-2.5 w-2.5 rounded-full bg-accent" />{labels.kcal}</dt>
          <dd className="num text-lg font-extrabold">{nf(kcal.value)} <span className="text-sm font-medium text-muted">{labels.of(nf(kcal.target))}</span></dd>
          <dd className="text-xs text-muted">{rest(kcal)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-sm text-muted"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--chart-plan)' }} />{labels.protein}</dt>
          <dd className="num text-lg font-extrabold">{nf(protein.value)} <span className="text-sm font-medium text-muted">{labels.of(`${nf(protein.target)} ${labels.g}`)}</span></dd>
          <dd className="text-xs text-muted">{rest(protein, ` ${labels.g}`)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MacroBars({ rows, digits }: { rows: { label: string; value: number; target: number }[]; digits: Digits }) {
  return (
    <ul className="grid grid-cols-3 gap-3">
      {rows.map((r) => (
        <li key={r.label}>
          <p className="text-xs text-muted">{r.label}</p>
          <p className="num text-sm font-bold">{fmtNum(Math.round(r.value), digits)}<span className="font-normal text-muted"> / {fmtNum(r.target, digits)}</span></p>
          <span className="mt-1 block h-1.5 rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-muted/70" style={{ width: `${Math.min(100, (r.value / Math.max(1, r.target)) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
