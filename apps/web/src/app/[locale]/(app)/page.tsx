import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      <p className="mt-2 text-muted">{t('shell')}</p>
    </section>
  );
}
