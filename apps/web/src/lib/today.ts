import 'server-only';
import { cookies } from 'next/headers';

// The owner's calendar date on the server. The browser stores its time zone in the `tz` cookie
// (root layout); before that cookie exists, UTC is the best guess.
export async function localToday(): Promise<string> {
  const tz = (await cookies()).get('tz')?.value;
  if (tz) {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: decodeURIComponent(tz) });
    } catch {
      // Unknown zone name: fall through.
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/** The owner's IANA time zone from the `tz` cookie (UTC until the browser has set it). */
export async function localTimeZone(): Promise<string> {
  const tz = (await cookies()).get('tz')?.value;
  try {
    if (tz) {
      const z = decodeURIComponent(tz);
      new Intl.DateTimeFormat('en', { timeZone: z });
      return z;
    }
  } catch {
    // Unknown zone name.
  }
  return 'UTC';
}
