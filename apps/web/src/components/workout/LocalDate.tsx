'use client';

import { useEffect, useState } from 'react';
import { isoToday } from '@/lib/format';

/** Hidden `date` field with the phone's local date (forms that log something "today"). */
export function LocalDate({ name = 'date', fallback }: { name?: string; fallback: string }) {
  const [v, setV] = useState(fallback);
  useEffect(() => setV(isoToday()), []);
  return <input type="hidden" name={name} value={v} />;
}
