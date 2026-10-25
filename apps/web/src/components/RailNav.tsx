'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

const Books = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5h4v14H4zM10 5h4v14h-4zM16.5 5.6l3.6-.9 3 12.9-3.6.9z" transform="translate(-1.5 0)" />
  </svg>
);
const Coins = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </svg>
);

/** Spine (desktop) and top bar (mobile) navigation. Active item gets a saffron edge. */
export function RailNav({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const t = useTranslations('nav');
  const path = usePathname();
  const items = [
    { href: '/', label: t('library'), icon: <Books />, active: path === '/' || path.startsWith('/books') },
    { href: '/usage', label: t('usage'), icon: <Coins />, active: path.startsWith('/usage') },
  ];
  if (orientation === 'horizontal') {
    return (
      <nav className="flex items-center gap-1" aria-label={t('main')}>
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined}
            className={`rounded-lg px-2.5 py-1.5 text-sm ${i.active ? 'bg-paper/15 text-paper' : 'text-paper/75 hover:text-paper'}`}>
            {i.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex flex-col gap-1" aria-label={t('main')}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-1 px-1 py-3 text-[0.6875rem] leading-tight transition-colors ${
            i.active ? 'text-paper' : 'text-paper/60 hover:text-paper'}`}>
          {i.active && <span className="absolute inset-y-2 end-0 w-[3px] rounded-s bg-zafaran" aria-hidden="true" />}
          {i.icon}
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
