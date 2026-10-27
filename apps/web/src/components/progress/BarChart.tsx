'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtNum, type Digits } from '@/lib/format';

export interface Bar { key: string; label: string; value: number; partial?: boolean; detail?: string }

/**
 * Vertical bars from a zero baseline (one series, so no legend). Rounded top, 2px gaps, the
 * latest value labelled; a hover/touch tooltip per bar. A `partial` bar (the week in progress)
 * is drawn hollow so it isn't read as a drop.
 */
export function BarChart({ bars, unit, digits, label, partialNote, height = 170 }: {
  bars: Bar[];
  unit: string;
  digits: Digits;
  label: string;
  partialNote: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!bars.length) return null;

  const nf = (n: number) => fmtNum(Math.round(n), digits);
  const H = height;
  const M = { top: 20, right: 6, bottom: 22, left: 46 };
  const max = Math.max(...bars.map((b) => b.value), 1);
  const mag = 10 ** Math.floor(Math.log10(max / 3));
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= max / 3) ?? 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = (W - M.left - M.right) / bars.length;
  const bw = Math.max(4, Math.min(28, slot - 2));
  const sy = (v: number) => M.top + (1 - v / top) * (H - M.top - M.bottom);
  const base = sy(0);
  const cx = (i: number) => M.left + slot * i + slot / 2;
  const h = hover != null ? bars[hover] : null;
  const lastFull = bars.findLastIndex((b) => !b.partial);

  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" style={{ direction: 'ltr' }} role="img"
        aria-label={`${label}: ${bars.map((b) => `${b.label} ${nf(b.value)}`).join('، ')}`}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 6} y={sy(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{nf(v)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const y = sy(b.value), x = cx(i) - bw / 2, hgt = Math.max(0, base - y), r = Math.min(4, bw / 2, hgt);
          const d = `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${base}Z`;
          return (
            <g key={b.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={cx(i) - slot / 2} y={M.top} width={slot} height={H - M.top - M.bottom} fill="transparent" />
              {hgt > 0 && <path d={d} fill={b.partial ? 'none' : 'var(--chart-trend)'} stroke={b.partial ? 'var(--chart-trend)' : 'none'}
                strokeWidth="2" strokeDasharray={b.partial ? '3 3' : undefined} opacity={hover == null || hover === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {lastFull >= 0 && hover == null && (
          <text x={cx(lastFull)} y={sy(bars[lastFull]!.value) - 6} textAnchor={cx(lastFull) > W - 40 ? 'end' : 'middle'} fontSize="12" fontWeight="700" fill="var(--fg)" className="num">
            {nf(bars[lastFull]!.value)}
          </text>
        )}
        {[0, bars.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={cx(i)} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor={i ? 'end' : 'start'}>{bars[i]!.label}</text>
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm shadow-lg"
          style={{ left: `${(cx(hover!) / W) * 100}%`, transform: `translateX(${cx(hover!) > W / 2 ? 'calc(-100% - 8px)' : '8px'})` }}>
          <p className="text-xs text-muted">{h.label}{h.partial ? ` · ${partialNote}` : ''}</p>
          <p><b className="num">{nf(h.value)}</b> <span className="text-muted">{unit}</span></p>
          {h.detail && <p className="text-xs text-muted">{h.detail}</p>}
        </div>
      )}
    </div>
  );
}
