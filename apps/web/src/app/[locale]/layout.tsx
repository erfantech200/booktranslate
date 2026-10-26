import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import '../globals.css';

// Vazirmatn, self-hosted. Arabic-script and Latin subsets are separate files so each glyph
// falls back through the stack correctly.
const vazirmatn = localFont({ variable: '--font-vazirmatn', display: 'swap', src: [
  { path: '../../fonts/vazirmatn-arabic-400-normal.woff2', weight: '400' },
  { path: '../../fonts/vazirmatn-latin-400-normal.woff2', weight: '400' },
  { path: '../../fonts/vazirmatn-arabic-500-normal.woff2', weight: '500' },
  { path: '../../fonts/vazirmatn-latin-500-normal.woff2', weight: '500' },
  { path: '../../fonts/vazirmatn-arabic-700-normal.woff2', weight: '700' },
  { path: '../../fonts/vazirmatn-latin-700-normal.woff2', weight: '700' },
  { path: '../../fonts/vazirmatn-arabic-800-normal.woff2', weight: '800' },
  { path: '../../fonts/vazirmatn-latin-800-normal.woff2', weight: '800' },
] });

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0B0F14' };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: { default: t('name'), template: `%s | ${t('name')}` }, description: t('tagline') };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
