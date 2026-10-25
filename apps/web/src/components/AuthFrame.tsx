import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LogoMark, Wordmark } from './Logo';

// Si-o-se-pol's arcade: a row of pointed arches over the river, with their reflections.
function Arcade() {
  const w = 56, gap = 18, base = 120, spring = 64, apex = 30;
  const arches = Array.from({ length: 9 }, (_, i) => {
    const x = i * (w + gap) + gap / 2, m = x + w / 2, r = x + w;
    return {
      arch: `M${x} ${base}V${spring}C${x} ${spring - 18} ${m - 12} ${apex + 10} ${m} ${apex}C${m + 12} ${apex + 10} ${r} ${spring - 18} ${r} ${spring}V${base}`,
      echo: `M${x} ${base + 8}V${base + 22}C${x} ${base + 32} ${m - 12} ${base + 42} ${m} ${base + 48}C${m + 12} ${base + 42} ${r} ${base + 32} ${r} ${base + 22}V${base + 8}`,
    };
  });
  return (
    <svg viewBox={`0 0 ${9 * (w + gap)} 180`} className="w-full" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d={`M0 ${base}H${9 * (w + gap)}`} stroke="var(--color-zafaran)" strokeWidth="1.5" opacity=".7" />
      {arches.map((a, i) => (
        <g key={i} fill="none" strokeWidth="1.5">
          <path d={a.arch} stroke="var(--color-paper)" opacity=".22" />
          <path d={a.echo} stroke="#5CC4BC" opacity=".35" strokeDasharray="5 6" />
        </g>
      ))}
    </svg>
  );
}

/** Sign-in and set-password screens: lapis panel with the mark (desktop), form on paper. */
export async function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const app = await getTranslations('app');
  const t = await getTranslations('login');
  const nav = await getTranslations('nav');
  const locale = await getLocale();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-lajvard px-12 pt-14 text-paper lg:flex">
        <div>
          <LogoMark variant="reversed" draw className="h-28 w-28" />
          <p className="mt-8 font-display text-5xl font-bold leading-tight">{app('name')}</p>
          <p className="mt-1 text-sm text-paper/60"><span dir="auto">{locale === 'fa' ? 'Bookbridge' : 'پل کتاب'}</span></p>
          <p className="mt-10 max-w-sm text-lg leading-8 text-paper/85">{t('panel')}</p>
        </div>
        <div className="-mx-12 mt-16"><Arcade /></div>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <span className="lg:hidden"><Wordmark /></span>
          <Link href="/login" locale={locale === 'fa' ? 'en' : 'fa'} className="ms-auto text-sm text-muted hover:text-lajvard"
            lang={locale === 'fa' ? 'en' : 'fa'}>{nav('language')}</Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="font-display text-3xl font-bold text-lajvard">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
