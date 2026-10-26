import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/Logo';
import { TabBar } from '@/components/TabBar';
import { IconSettings } from '@/components/icons';
import { requireProfile } from '@/lib/profile';

/** App shell: header (mark + settings), page, tab bar. Every page here needs a finished onboarding. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireProfile();
  const t = await getTranslations();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 md:max-w-3xl md:px-6">
      <header className="flex items-center gap-3 pt-[max(env(safe-area-inset-top),1rem)] pb-3 md:gap-6">
        <Link href="/" className="flex items-center gap-2 rounded-xl" aria-label={t('nav.today')}>
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-extrabold">{t('app.name')}</span>
        </Link>
        <div className="hidden flex-1 md:block"><TabBar /></div>
        <Link href="/settings" className="ms-auto rounded-xl p-2 text-muted hover:text-fg md:ms-0" aria-label={t('nav.settings')} title={t('nav.settings')}>
          <IconSettings />
        </Link>
      </header>
      <main className="flex-1 pb-28 md:pb-12">{children}</main>
      <div className="md:hidden"><TabBar /></div>
    </div>
  );
}
