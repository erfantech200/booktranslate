import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthFrame } from '@/components/AuthFrame';
import { NewPasswordForm } from './NewPasswordForm';

/** Reached from a password-recovery email (the callback has already signed the user in). */
export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('login');
  return (
    <AuthFrame title={t('newPasswordTitle')}>
      <NewPasswordForm />
    </AuthFrame>
  );
}
