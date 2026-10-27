import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const TABS = [
  { key: 'overview', href: '/progress' },
  { key: 'strength', href: '/progress/strength' },
  { key: 'body', href: '/progress/body' },
  { key: 'journey', href: '/progress/journey' },
] as const;

/** Page title + the Progress sub-sections as a segmented control. */
export async function ProgressHeader({ active }: { active: (typeof TABS)[number]['key'] }) {
  const t = await getTranslations('progress');
  return (
    <header className="space-y-3 pt-2">
      <h1 className="text-3xl font-extrabold">{t('title')}</h1>
      <nav aria-label={t('nav')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex w-max min-w-full gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {TABS.map((x) => (
            <li key={x.key} className="flex-1">
              <Link href={x.href} aria-current={x.key === active ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-lg px-3 py-2 text-center ${x.key === active ? 'bg-surface font-bold text-fg shadow' : 'text-muted hover:text-fg'}`}>
                {t(`tabs.${x.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
