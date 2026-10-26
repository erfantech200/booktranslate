import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PhotoUploader } from '@/components/PhotoUploader';
import { loadPhotos } from '@/lib/photos';
import { requireProfile } from '@/lib/profile';

/** Baseline progress photos, right after onboarding (skippable). */
export default async function OnboardingPhotosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('onboarding');
  const tc = await getTranslations('common');
  const photos = await loadPhotos(sb, profile.start_date!);
  return (
    <main className="mx-auto max-w-xl px-4 pt-[max(env(safe-area-inset-top),1.25rem)] pb-16">
      <h1 className="text-2xl font-extrabold">{t('photosTitle')}</h1>
      <p className="mt-3 text-muted">{t('photosIntro')}</p>
      <div className="note note-info mt-5">{t('photosGuide')}</div>
      <div className="mt-6"><PhotoUploader date={profile.start_date!} existing={photos} /></div>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn btn-primary flex-1">{t('photosDone')}</Link>
        {photos.length === 0 && <Link href="/" className="btn btn-ghost">{tc('skip')}</Link>}
      </div>
    </main>
  );
}
