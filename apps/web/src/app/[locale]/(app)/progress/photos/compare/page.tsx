import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PhotoCompare } from '@/components/progress/PhotoCompare';
import { requireProfile } from '@/lib/profile';
import { loadPhotoIndex, signPhotos } from '@/lib/progress';

export const dynamic = 'force-dynamic';

/** Compare two days of progress photos (defaults: the first day and the latest). */
export default async function ComparePage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('progress.compare');
  const tb = await getTranslations('progress.body');
  const sp = await searchParams;
  const photos = await loadPhotoIndex(sb);
  const dates = [...new Set(photos.map((p) => p.date))].sort();
  const a = dates.includes(sp.a ?? '') ? sp.a! : dates[0];
  const b = dates.includes(sp.b ?? '') ? sp.b! : dates.at(-1);
  const pick = photos.filter((p) => p.date === a || p.date === b);
  const urls = await signPhotos(sb, pick);
  const side = (date: string | undefined) => Object.fromEntries(pick.filter((p) => p.date === date && urls.has(p.id)).map((p) => [p.angle, urls.get(p.id)!]));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <Link href="/progress/body#photos" className="btn btn-ghost">{tb('photosTitle')}</Link>
      </div>
      {dates.length < 2 || !a || !b ? <p className="card text-muted">{t('need')}</p> : (
        <section className="card">
          <PhotoCompare dates={dates} a={a} b={b} urls={{ a: side(a), b: side(b) }} digits={profile.digits} />
        </section>
      )}
    </div>
  );
}
