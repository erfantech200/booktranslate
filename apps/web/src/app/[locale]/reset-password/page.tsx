import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewPasswordForm } from './NewPasswordForm';

/** Reached from a password-recovery email (the callback has already signed the user in). */
export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('login');
  const app = await getTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold text-accent">{app('name')}</h1>
        <p className="mt-1 text-slate-600">{t('newPasswordTitle')}</p>
      </div>
      <NewPasswordForm />
    </main>
  );
}
