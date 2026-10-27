'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { COACH } from '@coach/core/shared';
import { fmtNum, type Digits } from '@/lib/format';

/** End-of-day nudge (spec §9): in the evening, if protein is far below target. Fixed copy. */
export function ProteinNudge({ protein, target, digits }: { protein: number; target: number; digits: Digits }) {
  const t = useTranslations('nutrition');
  const [late, setLate] = useState(false);
  useEffect(() => setLate(new Date().getHours() >= COACH.nutrition.nudgeAfterHour), []);
  if (!late || protein >= (target * COACH.nutrition.lowProteinNudgePct) / 100) return null;
  return <p role="note" className="note note-warn">{t('proteinNudge', { n: fmtNum(Math.round(target - protein), digits) })}</p>;
}
