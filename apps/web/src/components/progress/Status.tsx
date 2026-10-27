import { IconAlert, IconCheck, IconInfo, IconMinus } from '../icons';

export type Tone = 'good' | 'neutral' | 'warn' | 'muted';
const STYLE: Record<Tone, { cls: string; Icon: typeof IconCheck }> = {
  good: { cls: 'bg-ok-soft text-ok', Icon: IconCheck },
  neutral: { cls: 'bg-surface-2 text-fg', Icon: IconMinus },
  warn: { cls: 'bg-accent-soft text-accent-text', Icon: IconAlert },
  muted: { cls: 'bg-surface-2 text-muted', Icon: IconInfo },
};

/** A status always carries an icon and a word, never colour alone. */
export function Status({ tone, children, size = 'md' }: { tone: Tone; children: React.ReactNode; size?: 'sm' | 'md' }) {
  const { cls, Icon } = STYLE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${cls} ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />{children}
    </span>
  );
}
