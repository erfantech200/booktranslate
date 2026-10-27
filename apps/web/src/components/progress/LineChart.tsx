'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtNum, type Digits } from '@/lib/format';

export interface LinePt { date: string; value: number }

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const isoOf = (d: number) => new Date(Math.round(d) * 86_400_000).toISOString().slice(0, 10);

function niceStep(span: number, ticks = 3) {
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
}

/**
 * One series over time (small-multiple friendly: the title names the series, so no legend).
 * 2px line, markers on each point, crosshair + tooltip on hover/touch, arrow keys on focus.
 */
export function LineChart({ points, domain, unit, digits, label, height = 150, decimals = 1 }: {
  points: LinePt[];
  domain?: { from: string; to: string };
  unit: string;
  digits: Digits;
  label: string;
  height?: number;
  decimals?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nf = (n: number) => fmtNum(n, digits, { maximumFractionDigits: decimals });
  const H = height;
  const M = { top: 22, right: 10, bottom: 24, left: 40 };
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return null;
  const x0 = day(domain?.from ?? pts[0]!.date), x1 = Math.max(day(domain?.to ?? pts.at(-1)!.date), x0 + 1);
  const vs = pts.map((p) => p.value);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const step = niceStep(Math.max(hi - lo, Math.abs(hi) * 0.04, 0.5));
  const y0 = Math.floor((lo - step * 0.2) / step) * step, y1 = Math.ceil((hi + step * 0.2) / step) * step;
  const sx = (d: number) => M.left + ((d - x0) / (x1 - x0)) * (W - M.left - M.right);
  const sy = (v: number) => M.top + (1 - (v - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  const ticks = Array.from({ length: Math.round((y1 - y0) / step) + 1 }, (_, i) => y0 + i * step);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(day(p.date)).toFixed(1)} ${sy(p.value).toFixed(1)}`).join('');
  const last = pts.at(-1)!;

  function pick(clientX: number) {
    const r = svg.current!.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(sx(day(p.date)) - vx) < Math.abs(sx(day(pts[best]!.date)) - vx)) best = i; });
    setHover(best);
  }
  const h = hover != null ? pts[hover] : null;
  const hx = h ? sx(day(h.date)) : 0;

  return (
    <div ref={box} className="relative">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" style={{ direction: 'ltr' }}
        role="img" aria-label={`${label}: ${nf(last.value)} ${unit}`} tabIndex={0}
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((i) => Math.min(pts.length - 1, (i ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((i) => Math.max(0, (i ?? pts.length) - 1));
          if (e.key === 'Escape') setHover(null);
        }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 6} y={sy(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{nf(v)}</text>
          </g>
        ))}
        {[x0, x1].map((d, i) => (
          <text key={i} x={sx(d)} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor={i ? 'end' : 'start'}>{fmtDate(isoOf(d), digits)}</text>
        ))}
        {pts.length > 1 && <path d={path} fill="none" stroke="var(--chart-trend)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {pts.map((p) => <circle key={p.date} cx={sx(day(p.date))} cy={sy(p.value)} r="4" fill="var(--chart-trend)" stroke="var(--surface)" strokeWidth="2" />)}
        {!h && (
          <text x={sx(day(last.date))} y={sy(last.value) - 10} fontSize="12" fontWeight="700" fill="var(--fg)" className="num"
            textAnchor={sx(day(last.date)) > W - 60 ? 'end' : 'middle'}>{nf(last.value)}</text>
        )}
        {h && <line x1={hx} x2={hx} y1={M.top - 8} y2={H - M.bottom} stroke="var(--muted)" strokeWidth="1" />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm shadow-lg"
          style={{ left: `${(hx / W) * 100}%`, transform: `translateX(${hx > W / 2 ? 'calc(-100% - 8px)' : '8px'})` }}>
          <p className="text-xs text-muted">{fmtDate(h.date, digits, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p><b className="num">{nf(h.value)}</b> <span className="text-muted">{unit}</span></p>
        </div>
      )}
    </div>
  );
}
