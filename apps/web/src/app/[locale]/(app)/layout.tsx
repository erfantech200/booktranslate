import { getTranslations } from 'next-intl/server';
import { signOut } from '../actions';

/** Phase 0 shell: a header with sign-out. Phase 1 replaces it with the tab navigation. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4">
      <header className="flex items-center justify-between py-4">
        <span className="text-lg font-extrabold">{t('app.name')}</span>
        <form action={signOut}><button className="text-sm text-muted hover:text-fg">{t('nav.signOut')}</button></form>
      </header>
      <main className="flex-1 pb-10">{children}</main>
    </div>
  );
}
