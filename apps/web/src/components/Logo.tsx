// Brand mark: an open book whose underside is a pointed Persian arch (as on Isfahan's
// Si-o-se-pol bridge), reflected in the river. Source files: docs/brand/*.svg.

const BODY = 'M4 23C13 17.5 24 17.8 32 24.6C40 17.8 51 17.5 60 23V41H40.5V35.2C40.5 31.6 36.9 29.4 32 26.2C27.1 29.4 23.5 31.6 23.5 35.2V41H4Z';
const PAGES = 'M9 27.6C15.4 24.6 22 24.8 27.6 28.6M9 32.2C13.8 30.4 18.4 30.4 21.4 31.6M55 27.6C48.6 24.6 42 24.8 36.4 28.6M55 32.2C50.2 30.4 45.6 30.4 42.6 31.6';
const KEYSTONE = 'M32 19.6L33.9 22.4L32 25.2L30.1 22.4Z';
const REFLECTION = 'M23.5 45V47.2C23.5 50.6 27.1 52.9 32 56C36.9 52.9 40.5 50.6 40.5 47.2V45';
const WATER = 'M6 45H18M46 45H58';

export function LogoMark({ variant = 'color', className, draw = false }: {
  variant?: 'color' | 'reversed';
  className?: string;
  /** Draw the arch reflection in once (login screen). Respects prefers-reduced-motion. */
  draw?: boolean;
}) {
  const rev = variant === 'reversed';
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <path d={BODY} fill={rev ? 'var(--color-paper)' : 'var(--color-lajvard)'} />
      <path d={PAGES} fill="none" stroke={rev ? 'var(--color-lajvard)' : 'var(--color-paper)'} strokeWidth="1.3" strokeLinecap="round" />
      <path d={KEYSTONE} fill={rev ? '#E8A93A' : 'var(--color-zafaran)'} />
      <path d={REFLECTION} fill="none" stroke={rev ? '#5CC4BC' : 'var(--color-firoozeh)'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={draw ? 'logo-draw' : undefined} />
      <path d={WATER} fill="none" stroke={rev ? '#5CC4BC' : 'var(--color-firoozeh)'} strokeWidth="1.8" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

export function Wordmark({ variant = 'color', size = 'md' }: { variant?: 'color' | 'reversed'; size?: 'md' | 'lg' }) {
  const rev = variant === 'reversed';
  return (
    <span className={`inline-flex items-center gap-2.5 ${rev ? 'text-paper' : 'text-lajvard'}`}>
      <LogoMark variant={variant} className={size === 'lg' ? 'h-14 w-14' : 'h-9 w-9'} />
      <span className="flex flex-col leading-none">
        <span className={`whitespace-nowrap font-display font-bold ${size === 'lg' ? 'text-4xl' : 'text-xl'}`}>پل کتاب</span>
        <span className={`mt-1 font-ui tracking-wide ${size === 'lg' ? 'text-sm' : 'text-[11px]'} ${rev ? 'text-paper/70' : 'text-muted'}`} dir="ltr">Bookbridge</span>
      </span>
    </span>
  );
}
