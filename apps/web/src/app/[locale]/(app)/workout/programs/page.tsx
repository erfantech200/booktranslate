import { getTranslations, setRequestLocale } from 'next-intl/server';
import { weekOf } from '@coach/core/shared';
import { Link } from '@/i18n/navigation';
import { ConfirmSubmit } from '@/components/workout/ConfirmSubmit';
import { ProgramForm } from '@/components/workout/ProgramForm';
import { fmtNum } from '@/lib/format';
import { requireProfile } from '@/lib/profile';
import { deleteProgram, renameProgram, switchProgram } from '@/lib/programActions';
import { programLabel } from '@/lib/programLabel';
import { localToday } from '@/lib/today';
import { loadProgramBlocks, loadPrograms } from '@/lib/training';

export const dynamic = 'force-dynamic';

/** Every training program: switch the active one, rename, delete, or make a new one. */
export default async function ProgramsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sb, profile } = await requireProfile();
  const t = await getTranslations('programs');
  const tw = await getTranslations('workout');
  const tpf = await getTranslations('profile');
  const tc = await getTranslations('common');
  const d = profile.digits;
  const today = await localToday();
  const [programs, blocks, { data: running }] = await Promise.all([
    loadPrograms(sb), loadProgramBlocks(sb), sb.from('workout_sessions').select('id').eq('status', 'active').maybeSingle(),
  ]);
  // Active first, then the most recently made.
  const list = [...programs].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <Link href="/workout" className="btn btn-ghost">{tw('title')}</Link>
      </div>
      <p className="text-sm text-muted">{t('intro')}</p>

      {running && (
        <div className="note note-warn">
          <p>{t('workoutRunning')}</p>
          <Link href="/gym" className="btn btn-secondary mt-3 w-full">{t('resumeWorkout')}</Link>
        </div>
      )}

      {list.map((p) => {
        const m = blocks.get(p.id);
        const w = m ? weekOf(m.startDate, m.pausedAt ?? today) : 0;
        const label = programLabel(p, t, d);
        return (
          <section key={p.id} className={`card ${p.active ? 'border-accent' : ''}`} aria-label={label}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold">{label}</h2>
                <p className="text-sm text-muted">
                  {p.name
                    ? `${tpf(p.trainLocation)} · ${t('settings', { days: fmtNum(p.daysPerWeek, d), minutes: fmtNum(p.sessionMinutes, d) })}`
                    : t('minutes', { minutes: fmtNum(p.sessionMinutes, d) })}
                </p>
                <p className="num mt-0.5 text-sm text-muted">
                  {!m ? t('noBlock') : w > m.deloadWeek
                    ? t('blockOver', { n: fmtNum(m.blockNo, d) })
                    : t('blockWeek', { n: fmtNum(m.blockNo, d), week: fmtNum(Math.max(1, w), d), weeks: fmtNum(m.weeks, d) })}
                </p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${p.active ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-muted'}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${p.active ? 'bg-accent' : 'border border-muted'}`} />
                {p.active ? t('active') : t('paused')}
              </span>
            </div>

            {!p.active && !running && (
              <form action={switchProgram.bind(null, p.id)} className="mt-4">
                <ConfirmSubmit className="btn btn-primary w-full">{t('switch')}</ConfirmSubmit>
              </form>
            )}

            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer py-1 text-sm font-medium text-accent-text">{t('rename')} / {t('delete')}</summary>
              <form action={renameProgram.bind(null, p.id)} className="mt-3 flex items-end gap-2">
                <label className="field mb-0 flex-1">
                  <span className="field-label">{t('name')}</span>
                  <input className="input" name="name" defaultValue={p.name ?? ''} maxLength={60} placeholder={t('namePlaceholder')} />
                </label>
                <ConfirmSubmit className="btn btn-secondary">{tc('save')}</ConfirmSubmit>
              </form>
              <form action={deleteProgram.bind(null, p.id)} className="mt-3">
                <ConfirmSubmit className="btn btn-ghost w-full text-danger" confirm={t('deleteConfirm')}>{t('delete')}</ConfirmSubmit>
              </form>
            </details>
          </section>
        );
      })}

      <details className="card" open={programs.length === 0}>
        <summary className="cursor-pointer text-lg font-extrabold">{t('new')}</summary>
        <div className="mt-4">
          <ProgramForm initial={{
            trainLocation: profile.train_location ?? 'gym', equipment: profile.equipment,
            daysPerWeek: String(profile.days_per_week ?? 3), sessionMinutes: String(profile.session_minutes ?? 60),
            preferredDays: profile.preferred_days.map(String),
          }} />
        </div>
      </details>
    </div>
  );
}
