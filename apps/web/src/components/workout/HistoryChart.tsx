import { fmtDate, fmtNum, type Digits } from '@/lib/format';

/** Best set per session over time (e1RM, or reps/seconds for bodyweight and timed work). */
export function HistoryChart({ points, digits, label, unit }: { points: { date: string; v: number }[]; digits: Digits; label: string; unit: string }) {
  const W = 320, H = 140, M = { t: 14, r: 10, b: 22, l: 34 };
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y0 = Math.floor(lo - pad), y1 = Math.ceil(hi + pad);
  const x = (i: number) => M.l + (points.length === 1 ? (W - M.l - M.r) / 2 : (i / (points.length - 1)) * (W - M.l - M.r));
  const y = (v: number) => M.t + (1 - (v - y0) / Math.max(1, y1 - y0)) * (H - M.t - M.b);
  const last = points.at(-1)!;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ direction: 'ltr' }} role="img"
        aria-label={`${label}: ${fmtNum(last.v, digits)} ${unit}`}>
        {[y0, (y0 + y1) / 2, y1].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--muted)" className="num">{fmtNum(Math.round(v), digits)}</text>
          </g>
        ))}
        <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')} fill="none" stroke="var(--chart-trend)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.v)} r="3" fill="var(--chart-trend)" stroke="var(--surface)" strokeWidth="1.5" />)}
        <text x={x(points.length - 1)} y={y(last.v) - 8} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--fg)" className="num">{fmtNum(last.v, digits)}</text>
        <text x={M.l} y={H - 6} fontSize="10" fill="var(--muted)">{fmtDate(points[0]!.date, digits)}</text>
        {points.length > 1 && <text x={W - M.r} y={H - 6} fontSize="10" fill="var(--muted)" textAnchor="end">{fmtDate(last.date, digits)}</text>}
      </svg>
      <figcaption className="field-hint">{label}</figcaption>
    </figure>
  );
}
