import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import '../globals.css';

// Estedad (Persian-designed UI face), Noto Kufi Arabic + Reem Kufi Latin (geometric Kufic, for
// titles and the wordmark; Reem Kufi's Arabic dots the final Persian «ی», so it is Latin-only),
// Noto Naskh Arabic (the translated text, as in the printed PDF). Arabic-script and Latin
// subsets are separate families so per-glyph fallback works through the font stack.
const estedadAr = localFont({ variable: '--font-estedad-ar', display: 'swap', src: [
  { path: '../../fonts/estedad-arabic-400-normal.woff2', weight: '400' },
  { path: '../../fonts/estedad-arabic-500-normal.woff2', weight: '500' },
  { path: '../../fonts/estedad-arabic-700-normal.woff2', weight: '700' },
] });
const estedadLat = localFont({ variable: '--font-estedad-lat', display: 'swap', src: [
  { path: '../../fonts/estedad-latin-400-normal.woff2', weight: '400' },
  { path: '../../fonts/estedad-latin-500-normal.woff2', weight: '500' },
  { path: '../../fonts/estedad-latin-700-normal.woff2', weight: '700' },
] });
// unicode-range: Arabic script only, so Latin titles fall through to Reem Kufi Latin.
const kufiAr = localFont({ variable: '--font-kufi-ar', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+200C-200F, U+FB50-FDFF, U+FE70-FEFF' }], src: [
  { path: '../../fonts/noto-kufi-arabic-arabic-600-normal.woff2', weight: '600' },
  { path: '../../fonts/noto-kufi-arabic-arabic-700-normal.woff2', weight: '700' },
] });
const kufiLat = localFont({ variable: '--font-kufi-lat', display: 'swap', src: [
  { path: '../../fonts/reem-kufi-latin-500-normal.woff2', weight: '500' },
  { path: '../../fonts/reem-kufi-latin-700-normal.woff2', weight: '700' },
] });
const naskh = localFont({ variable: '--font-naskh', display: 'swap', preload: false, src: [
  { path: '../../fonts/NotoNaskhArabic-arabic-400.woff2', weight: '400' },
] });

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1E2F6B' };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: { default: t('name'), template: `%s | ${t('name')}` }, description: t('tagline'), manifest: '/manifest.webmanifest' };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const fonts = [estedadAr, estedadLat, kufiAr, kufiLat, naskh].map((f) => f.variable).join(' ');
  return (
    <html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} className={fonts}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
