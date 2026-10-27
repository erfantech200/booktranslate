import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FOOD_CATEGORIES, groceryList } from '@coach/core/shared';
import { GroceryList } from '@/components/nutrition/GroceryList';
import { fmtNum } from '@/lib/format';
import { foodMap, loadPlan, planDays, weekStartOf } from '@/lib/nutrition';
import { requireProfile } from '@/lib/profile';
import { localToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

export default async function GroceryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('nutrition');
  const d = profile.digits;
  const weekStart = weekStartOf(await localToday());
  const [plan, foods] = await Promise.all([loadPlan(sb, weekStart), foodMap()]);
  const lines = plan?.status === 'ready' ? groceryList(planDays(plan), foods) : [];
  const amount = (grams: number, units: number | null) =>
    units != null ? t('units', { n: fmtNum(units, d) }) : grams >= 1000 ? t('kgValue', { n: fmtNum(grams / 1000, d, { maximumFractionDigits: 2 }) }) : t('gValue', { n: fmtNum(grams, d) });
  // Amounts are raw, so cooked foods are listed without "پخته" (cooked).
  const shopName = (id: string) => {
    const f = foods.get(id);
    return !f ? id : f.rawPerCooked != null ? f.nameFa.replace(/\s*پخته/g, '') : f.nameFa;
  };
  const groups = FOOD_CATEGORIES.map((c) => ({
    title: t(`category.${c}`),
    lines: lines.filter((l) => l.category === c).map((l) => ({ id: l.food, name: shopName(l.food), amount: amount(l.grams, l.units) })),
  })).filter((g) => g.lines.length > 0);
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-extrabold">{t('groceryTitle')}</h1>
      {groups.length === 0 ? <p className="card text-muted">{t('groceryEmpty')}</p> : (
        <>
          <p className="text-sm text-muted">{t('groceryHint')}</p>
          <GroceryList week={weekStart} groups={groups} />
        </>
      )}
    </div>
  );
}
