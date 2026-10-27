import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PhotoCamera } from '@/components/progress/PhotoCamera';
import { requireProfile } from '@/lib/profile';
import { loadPhotoIndex, signPhotos } from '@/lib/progress';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

/** Take today's progress photos, with the previous photo of each angle as a ghost overlay. */
export default async function NewPhotosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb } = await requireProfile();
  const t = await getTranslations('progress.camera');
  const today = await localToday();
  const photos = await loadPhotoIndex(sb);
  // The ghost is the latest photo of each angle from an earlier day.
  const ghosts = (['front', 'side', 'back'] as const).map((a) => photos.find((p) => p.angle === a && p.date < today)).filter((p) => !!p);
  const urls = await signPhotos(sb, ghosts);
  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <Link href="/progress/body#photos" className="btn btn-ghost">{t('done')}</Link>
      </div>
      <PhotoCamera ghosts={Object.fromEntries(ghosts.map((p) => [p.angle, urls.get(p.id)]))}
        doneToday={photos.filter((p) => p.date === today).map((p) => p.angle)} />
    </div>
  );
}
