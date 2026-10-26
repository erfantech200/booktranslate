'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtNum, type Digits } from '@/lib/format';

export interface Pt { date: string; kg: number }
export interface WeightChartProps {
  raw: Pt[];
  trend: Pt[];
  plan: Pt[];
  projection: { from: Pt; to: Pt } | null;
  domain: { from: string; to: string };
  target: Pt | null;
  digits: Digits;
  labels: { raw: string; trend: string; plan: string; projection: string; kg: string };
}

const M = { top: 16, right: 16, bottom: 30, left: 44 };
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function niceStep(span: number) {
  const raw = span / 4;
  return [0.5, 1, 2, 2.5, 5, 10].find((s) => s >= raw) ?? 20;
}

/** Linear interpolation of a date-sorted series at day `x` (null outside it). */
function at(series: Pt[], x: number): number | null {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!, b = series[i]!;
    const xa = day(a.date), xb = day(b.date);
    if (x >= xa && x <= xb) return xb === xa ? b.kg : a.kg + ((b.kg - a.kg) * (x - xa)) / (xb - xa);
  }
  return null;
}

/**
 * Bodyweight over time: daily weigh-ins (recessive dots), the 7-day average (accent line), the
 * plan line, and the current trend extended to the end of the plan. Time runs left to right.
 * Crosshair + tooltip on hover, arrow keys on focus.
 */
export function WeightChart(p: WeightChartProps) {
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real pixel width so text and marks keep their size on a phone.
  const [W, setW] = useState(640);
  const H = W < 480 ? 220 : 260;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x0 = day(p.domain.from), x1 = day(p.domain.to);
  const ys = [...p.raw, ...p.trend, ...p.plan, ...(p.projection ? [p.projection.from, p.projection.to] : []), ...(p.target ? [p.target] : [])]
    .filter((q) => day(q.date) >= x0 && day(q.date) <= x1).map((q) => q.kg);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const step = niceStep(Math.max(1, hi - lo));
  const y0 = Math.floor((lo - step * 0.25) / step) * step, y1 = Math.ceil((hi + step * 0.25) / step) * step;
  const sx = (d: number) => M.left + ((d - x0) / Math.max(1, x1 - x0)) * (W - M.left - M.right);
  const sy = (kg: number) => M.top + (1 - (kg - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  const path = (s: Pt[]) => s.map((q, i) => `${i ? 'L' : 'M'}${sx(day(q.date)).toFixed(1)} ${sy(q.kg).toFixed(1)}`).join('');
  const ticks = Array.from({ length: Math.round((y1 - y0) / step) + 1 }, (_, i) => y0 + i * step);
  const xTicks = [x0, (x0 + x1) / 2, x1].map((d) => new Date(Math.round(d) * 86_400_000).toISOString().slice(0, 10));
  const nf = (n: number) => fmtNum(n, p.digits);

  // Hover positions: every weigh-in date, plus plan weeks when there are no weigh-ins yet.
  const stops = useMemo(() => {
    const dates = new Set<string>(p.raw.map((q) => q.date));
    if (dates.size === 0) p.plan.forEach((q) => dates.add(q.date));
    return [...dates].filter((d) => day(d) >= x0 && day(d) <= x1).sort();
  }, [p.raw, p.plan, x0, x1]);

  function pick(clientX: number) {
    const r = svg.current!.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    stops.forEach((d, i) => { if (Math.abs(sx(day(d)) - vx) < Math.abs(sx(day(stops[best]!)) - vx)) best = i; });
    setHover(stops.length ? best : null);
  }

  const hd = hover != null ? stops[hover] : null;
  const hx = hd ? sx(day(hd)) : 0;
  const rows = hd ? [
    { key: p.labels.raw, value: p.raw.find((q) => q.date === hd)?.kg, color: 'var(--chart-raw)', dot: true },
    { key: p.labels.trend, value: p.trend.find((q) => q.date === hd)?.kg ?? at(p.trend, day(hd)), color: 'var(--chart-trend)' },
    { key: p.labels.plan, value: at(p.plan, day(hd)), color: 'var(--chart-plan)' },
  ].filter((r) => r.value != null) : [];
  const lastTrend = p.trend.filter((q) => day(q.date) <= x1).at(-1);

  return (
    <figure className="m-0">
      <div ref={box} className="relative">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" style={{ direction: 'ltr' }} role="img"
          aria-label={`${p.labels.trend}${lastTrend ? `: ${nf(lastTrend.kg)} ${p.labels.kg}` : ''}`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (!stops.length) return;
            if (e.key === 'ArrowRight') setHover((h) => Math.min(stops.length - 1, (h ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? stops.length) - 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={M.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--muted)" className="num">{nf(v)}</text>
            </g>
          ))}
          {xTicks.map((d, i) => (
            <text key={d} x={sx(day(d))} y={H - 8} fontSize="12" fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
              {fmtDate(d, p.digits)}
            </text>
          ))}
          <defs><clipPath id="plot"><rect x={M.left} y={0} width={W - M.left - M.right} height={H - M.bottom} /></clipPath></defs>
          <g clipPath="url(#plot)">
            {p.plan.length > 1 && <path d={path(p.plan)} fill="none" stroke="var(--chart-plan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
            {p.projection && <path d={path([p.projection.from, p.projection.to])} fill="none" stroke="var(--chart-trend)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />}
            {p.raw.map((q) => <circle key={q.date} cx={sx(day(q.date))} cy={sy(q.kg)} r="4" fill="var(--chart-raw)" stroke="var(--surface)" strokeWidth="2" />)}
            {p.trend.length > 1 && <path d={path(p.trend)} fill="none" stroke="var(--chart-trend)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
            {lastTrend && <circle cx={sx(day(lastTrend.date))} cy={sy(lastTrend.kg)} r="5" fill="var(--chart-trend)" stroke="var(--surface)" strokeWidth="2" />}
            {p.target && day(p.target.date) <= x1 && (
              <circle cx={sx(day(p.target.date))} cy={sy(p.target.kg)} r="5" fill="var(--surface)" stroke="var(--chart-plan)" strokeWidth="2" />
            )}
          </g>
          {lastTrend && !hd && (
            <text x={Math.min(sx(day(lastTrend.date)) + 9, W - M.right)} y={sy(lastTrend.kg) - 10} fontSize="13" fontWeight="700" fill="var(--fg)"
              textAnchor={sx(day(lastTrend.date)) > W - 90 ? 'end' : 'start'} className="num">{nf(lastTrend.kg)}</text>
          )}
          {hd && <line x1={hx} x2={hx} y1={M.top} y2={H - M.bottom} stroke="var(--muted)" strokeWidth="1" />}
        </svg>
        {hd && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm shadow-lg"
            style={{ left: `${(hx / W) * 100}%`, transform: `translateX(${hx > W / 2 ? 'calc(-100% - 10px)' : '10px'})` }}>
            <p className="mb-1 text-muted">{fmtDate(hd, p.digits, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {rows.map((r) => (
              <p key={r.key} className="flex items-center gap-2">
                {r.dot ? <span className="h-2 w-2 rounded-full" style={{ background: r.color }} /> : <span className="h-0.5 w-3 rounded" style={{ background: r.color }} />}
                <b className="num">{nf(r.value!)}</b>
                <span className="text-muted">{r.key}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-raw)' }} />{p.labels.raw}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--chart-trend)' }} />{p.labels.trend}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--chart-plan)' }} />{p.labels.plan}</span>
        {p.projection && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted" style={{ borderColor: 'var(--chart-trend)' }} />{p.labels.projection}</span>}
      </figcaption>
    </figure>
  );
}
