import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GoogleSignIn } from './GoogleSignIn';

export default async function LoginPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error } = await searchParams;
  const t = await getTranslations('login');
  const app = await getTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold text-accent">{app('name')}</h1>
        <p className="mt-1 text-slate-600">{app('tagline')}</p>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error === 'not_allowed' ? t('notAllowed') : t('error')}</p>
      )}
      <GoogleSignIn label={t('google')} />
    </main>
  );
}
