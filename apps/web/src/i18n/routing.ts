import { defineRouting } from 'next-intl/routing';

// Persian only. Kept on next-intl for the message catalogue and fa-IR formatting; no URL prefix.
export const routing = defineRouting({
  locales: ['fa'],
  defaultLocale: 'fa',
  localePrefix: 'never',
});
export type Locale = (typeof routing.locales)[number];
