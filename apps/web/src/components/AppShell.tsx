import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { signOut } from '@/app/[locale]/actions';
import { LogoMark, Wordmark } from './Logo';
import { RailNav } from './RailNav';

const SignOutIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4" />
  </svg>
);

/**
 * Desktop: a lapis "book spine" rail on the start edge (right in Persian) with saffron bands.
 * Mobile: the same spine as a top bar.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('nav');
  const locale = await getLocale();
  const other = locale === 'fa' ? 'en' : 'fa';
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 start-0 z-20 hidden w-[84px] flex-col items-stretch bg-lajvard text-paper lg:flex">
        <Link href="/" className="flex justify-center px-3 pt-6 pb-5" aria-label={t('home')}>
          <LogoMark variant="reversed" className="h-12 w-12" />
        </Link>
        <div className="spine-band mx-3 h-[9px]" aria-hidden="true" />
        <div className="flex-1 pt-4"><RailNav orientation="vertical" /></div>
        <div className="spine-band mx-3 h-[9px]" aria-hidden="true" />
        <div className="flex flex-col items-center gap-3 py-5 text-paper/70">
          <Link href="/" locale={other} className="text-xs hover:text-paper" lang={other}>{t('language')}</Link>
          <form action={signOut}>
            <button className="rounded-md p-1.5 hover:text-paper" aria-label={t('signOut')} title={t('signOut')}><SignOutIcon /></button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b-2 border-zafaran bg-lajvard px-4 py-2.5 text-paper lg:hidden">
        <Link href="/" aria-label={t('home')}><Wordmark variant="reversed" /></Link>
        <div className="ms-auto flex items-center gap-1">
          <RailNav orientation="horizontal" />
          <Link href="/" locale={other} className="px-2 text-xs text-paper/75" lang={other}>{t('language')}</Link>
          <form action={signOut}>
            <button className="rounded-md p-1.5 text-paper/75" aria-label={t('signOut')}><SignOutIcon /></button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 sm:px-6 lg:ps-[calc(84px+2.5rem)] lg:pe-10 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
