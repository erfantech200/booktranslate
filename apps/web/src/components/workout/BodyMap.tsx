import type { Muscle } from '@coach/core/shared';

// Front and back figure built from muscle segments. Primary muscles in the accent colour,
// secondary in a lighter tint, the rest neutral. Mirrored shapes are drawn once per side.

type Shape = { m: Muscle | null; d: string };
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
/** Mirror an absolute M/L/Q/Z path across the figure's vertical axis (x → 120 − x). */
function mirror(d: string) {
  let n = 0;
  return d.replace(/[MLQZ]|-?[\d.]+/g, (tok) => {
    if (/[MLQZ]/.test(tok)) { n = 0; return tok; }
    return n++ % 2 === 0 ? `${120 - Number(tok)} ` : `${tok} `;
  }).trim();
}
const both = (m: Muscle | null, d: string): Shape[] => [{ m, d }, { m, d: mirror(d) }];
const pair = (m: Muscle | null, cx: number, cy: number, rx: number, ry: number): Shape[] => [{ m, d: ell(cx, cy, rx, ry) }, { m, d: ell(120 - cx, cy, rx, ry) }];

const HEAD: Shape[] = [{ m: null, d: ell(60, 20, 12, 14) }, { m: null, d: 'M54 33L66 33L67 42L53 42Z' }, ...pair(null, 24, 134, 4.5, 6), ...pair(null, 47, 238, 7, 5)];

const FRONT: Shape[] = [
  ...HEAD,
  { m: 'traps', d: 'M53 40L67 40L77 47L43 47Z' },
  ...both('chest', 'M43 48Q58 45 59 49L59 69Q50 74 42 68Q38 57 43 48Z'),
  ...pair('front_delts', 36, 55, 8.5, 10),
  ...pair('side_delts', 27.5, 58, 3.5, 9),
  ...pair('biceps', 30, 81, 5.5, 13),
  ...pair('forearms', 26.5, 111, 4.8, 15),
  { m: 'abs', d: 'M52 72L68 72Q69 92 67 112L53 112Q51 92 52 72Z' },
  ...both('obliques', 'M42 71L50 73Q49 92 51 110L45 108Q40 90 42 71Z'),
  ...both('adductors', 'M55 122L59 124L59 158L55 150Z'),
  ...pair('quads', 47.5, 150, 9.5, 28),
  ...pair('calves', 47.5, 205, 6, 21),
];

const BACK: Shape[] = [
  ...HEAD,
  { m: 'upper_back', d: 'M47 50L73 50L69 82L51 82Z' },
  { m: 'traps', d: 'M60 37L77 48L60 72L43 48Z' },
  ...pair('rear_delts', 36, 55, 8.5, 9.5),
  ...pair('side_delts', 27.5, 58, 3.5, 9),
  ...both('lats', 'M42 60Q37 82 48 102L55 98L51 62Z'),
  { m: 'lower_back', d: 'M52 88L68 88L69 110L51 110Z' },
  ...pair('triceps', 30, 81, 5.5, 13),
  ...pair('forearms', 26.5, 111, 4.8, 15),
  ...pair('glutes', 50.5, 124, 10, 11),
  ...pair('hamstrings', 48.5, 161, 9, 24),
  ...pair('calves', 48, 204, 7, 19),
];

function Figure({ shapes, primary, secondary, label }: { shapes: Shape[]; primary: Muscle[]; secondary: Muscle[]; label: string }) {
  const fill = (m: Muscle | null) => (m && primary.includes(m) ? 'var(--accent)' : m && secondary.includes(m) ? 'var(--bm-secondary)' : 'var(--line)');
  return (
    <figure className="m-0 flex flex-col items-center">
      <svg viewBox="0 0 120 250" className="h-56 w-auto" role="img" aria-label={label}>
        {shapes.map((s, i) => <path key={i} d={s.d} fill={fill(s.m)} stroke="var(--surface)" strokeWidth="1.2" />)}
      </svg>
      <figcaption className="mt-1 text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

export function BodyMap({ primary, secondary, labels }: { primary: Muscle[]; secondary: Muscle[]; labels: { front: string; back: string } }) {
  return (
    <div className="grid grid-cols-2 gap-2 [--bm-secondary:color-mix(in_srgb,var(--accent)_45%,var(--line))]">
      <Figure shapes={FRONT} primary={primary} secondary={secondary} label={labels.front} />
      <Figure shapes={BACK} primary={primary} secondary={secondary} label={labels.back} />
    </div>
  );
}
