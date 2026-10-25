import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { signOut } from '@/app/[locale]/actions';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('nav');
  const app = await getTranslations('app');
  const locale = await getLocale();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <Link href="/" className="text-lg font-bold text-accent">{app('name')}</Link>
        <nav className="flex flex-1 items-center gap-3 text-sm text-slate-600">
          <Link href="/" className="hover:text-accent">{t('library')}</Link>
          <Link href="/usage" className="hover:text-accent">{t('usage')}</Link>
        </nav>
        <Link href="/" locale={locale === 'fa' ? 'en' : 'fa'} className="text-sm text-slate-500 hover:text-accent">{t('language')}</Link>
        <form action={signOut}>
          <button className="text-sm text-slate-500 hover:text-accent">{t('signOut')}</button>
        </form>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
