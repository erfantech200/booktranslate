// Persian/Arabic-Indic digits and separators → Latin, so "۷۰٫۵" parses as 70.5. Used on every
// numeric input, in the browser and again on the server.
const MAP: Record<string, string> = { '٫': '.', '٬': '', '،': '.' };
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => { MAP[d] = String(i); });
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => { MAP[d] = String(i); });

export const latinDigits = (s: string) => s.replace(/[۰-۹٠-٩٫٬،]/g, (c) => MAP[c] ?? c).trim();

/** Normalizes digits in every string of a plain JSON-like value. */
export function normalizeDigits<T>(v: T): T {
  if (typeof v === 'string') return latinDigits(v) as T;
  if (Array.isArray(v)) return v.map(normalizeDigits) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDigits(x)])) as T;
  return v;
}
