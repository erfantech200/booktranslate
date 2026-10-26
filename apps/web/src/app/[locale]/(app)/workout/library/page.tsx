import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LibraryList } from '@/components/workout/LibraryList';
import { loadLibrary } from '@/lib/library';
import { requireProfile } from '@/lib/profile';
import { loadActiveMeso, loadExcluded } from '@/lib/training';

export const dynamic = 'force-dynamic';

export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('library');
  const [library, excluded, block] = await Promise.all([loadLibrary(), loadExcluded(sb), loadActiveMeso(sb)]);
  const inProgram = new Set(block?.days.flatMap((d) => d.exercises.map((x) => x.slug)) ?? []);
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-extrabold">{t('title')}</h1>
      <LibraryList digits={profile.digits} items={library.map((e) => ({
        slug: e.slug, nameFa: e.nameFa, nameEn: e.nameEn, pattern: e.pattern, primary: e.primary,
        excluded: excluded.has(e.slug), inProgram: inProgram.has(e.slug),
      }))} />
    </div>
  );
}
