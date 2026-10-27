'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { planStatus } from '@/lib/nutritionActions';

/** While a plan is being built, check its status every few seconds and refresh when it's done. */
export function PlanStatus({ planId }: { planId: string }) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await planStatus(planId).catch(() => 'pending' as const);
      if (!live) return;
      if (s !== 'pending') router.refresh();
      else setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 3000);
    return () => { live = false; clearTimeout(t); };
  }, [planId, router]);
  return null;
}
