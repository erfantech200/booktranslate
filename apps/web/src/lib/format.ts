// Number and date formatting. Gym numbers use Latin digits by default (COACH.display); Persian
// digits are a setting. Dates are shown in the Persian (Jalali) calendar.

export type Digits = 'latin' | 'persian';

export function numberFormatter(digits: Digits, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(digits === 'persian' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 1, ...opts });
}

export const fmtNum = (n: number, digits: Digits, opts?: Intl.NumberFormatOptions) => numberFormatter(digits, opts).format(n);

export function fmtDate(iso: string, digits: Digits, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  const locale = `fa-IR-u-ca-persian${digits === 'latin' ? '-nu-latn' : ''}`;
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
}

/** Local calendar date (YYYY-MM-DD). In the browser that is the owner's own date; it is sent with every log. */
export const isoToday = () => new Date().toLocaleDateString('en-CA');

/** Accept a client-supplied local date only if it is within a day of the server's UTC date. */
export function sanitizeLocalDate(v: unknown): string {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const diff = Math.abs(Date.parse(`${v}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
  return diff <= 86_400_000 ? v : today;
}
