import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PasswordSignIn } from './PasswordSignIn';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <p className="text-3xl font-extrabold">{t('app.name')}</p>
      <p className="mt-1 text-muted">{t('app.tagline')}</p>
      <h1 className="mt-10 mb-5 text-xl font-bold">{t('login.title')}</h1>
      <PasswordSignIn />
    </main>
  );
}
