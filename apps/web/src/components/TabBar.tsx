'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { IconCoach, IconNutrition, IconProgress, IconToday, IconWorkout } from './icons';

const TABS = [
  { href: '/', key: 'today', Icon: IconToday },
  { href: '/workout', key: 'workout', Icon: IconWorkout },
  { href: '/nutrition', key: 'nutrition', Icon: IconNutrition },
  { href: '/progress', key: 'progress', Icon: IconProgress },
  { href: '/coach', key: 'coach', Icon: IconCoach },
] as const;

/** Bottom tab bar on phones (thumb reach); a top segmented bar from md up. */
export function TabBar() {
  const t = useTranslations('nav');
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <nav aria-label={t('main')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:static md:border-0 md:bg-transparent md:pb-0 md:backdrop-blur-none">
      <ul className="mx-auto grid max-w-xl grid-cols-5 md:max-w-none md:gap-1 md:rounded-2xl md:border md:border-line md:bg-surface md:p-1">
        {TABS.map(({ href, key, Icon }) => {
          const on = active(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium transition-colors md:min-h-11 md:flex-row md:gap-2 md:rounded-xl md:text-sm ${
                  on ? 'text-accent-text md:bg-accent-soft' : 'text-muted hover:text-fg'}`}>
                <span className={`absolute top-0 h-[3px] w-8 rounded-b-full bg-accent transition-transform duration-200 md:hidden ${on ? 'scale-x-100' : 'scale-x-0'}`} aria-hidden="true" />
                <Icon className="h-6 w-6 md:h-5 md:w-5" />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
