import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LogoMark } from '@/components/Logo';
import { ProfileForm } from '@/components/ProfileForm';
import { loadProfile } from '@/lib/profile';

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { profile } = await loadProfile();
  if (profile?.onboarded_at) redirect('/');
  const t = await getTranslations('onboarding');
  return (
    <main className="mx-auto max-w-xl px-4 pt-[max(env(safe-area-inset-top),1.25rem)] pb-16">
      <div className="flex items-center gap-3">
        <LogoMark className="h-10 w-10" />
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      </div>
      <p className="mt-3 mb-8 text-muted">{t('intro')}</p>
      <ProfileForm mode="wizard" initial={{ cuisines: ['persian'], equipment: [], preferredDays: [], injuryAreas: [], cardioRisk: false }} />
    </main>
  );
}
