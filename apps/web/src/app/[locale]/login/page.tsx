import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthFrame } from '@/components/AuthFrame';
import { PasswordSignIn } from './PasswordSignIn';

export default async function LoginPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error } = await searchParams;
  const t = await getTranslations('login');
  return (
    <AuthFrame title={t('title')}>
      {error && (
        <p role="alert" className="note note-alert mb-5">{error === 'not_allowed' ? t('notAllowed') : t('error')}</p>
      )}
      <PasswordSignIn />
    </AuthFrame>
  );
}
