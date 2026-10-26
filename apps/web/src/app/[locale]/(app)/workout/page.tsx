import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-extrabold">{t('nav.workout')}</h1>
      <p className="card text-muted">{t('placeholder.workout')}</p>
    </div>
  );
}
