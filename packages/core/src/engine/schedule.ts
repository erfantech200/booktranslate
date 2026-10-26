import { COACH } from '../coach.config';
import { sessionMinutes, type Role } from './program';
import { addDays, toDay } from './weight';

// Calendar: which weekdays are training days, which program day is next, and what to do when a
// session is missed (spec §8: shift / merge / skip, never doubling volume). Weekday 0 = Saturday.

const T = COACH.training;

/** Defaults when no preferred days were chosen: rest days spread out, Friday off. */
export const DEFAULT_DAYS: Record<number, number[]> = {
  3: [0, 2, 4], // Sat, Mon, Wed
  4: [0, 1, 3, 4], // Sat, Sun, Tue, Wed
  5: [0, 1, 2, 4, 5], // Sat, Sun, Mon, Wed, Thu
  6: [0, 1, 2, 3, 4, 5], // Sat … Thu
};

/** Persian weekday index of an ISO date (0 = Saturday … 6 = Friday). */
export const weekday = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;

export function trainingDays(daysPerWeek: number, preferred: readonly number[] = []): number[] {
  const days = preferred.length === daysPerWeek ? [...preferred] : DEFAULT_DAYS[daysPerWeek] ?? DEFAULT_DAYS[3]!;
  return [...new Set(days)].sort((a, b) => a - b);
}

/** 1-based mesocycle week of `date` (weeks are 7-day windows from the start date). */
export const weekOf = (startDate: string, date: string) => Math.floor((toDay(date) - toDay(startDate)) / 7) + 1;

export const weekStart = (startDate: string, week: number) => addDays(startDate, (week - 1) * 7);

/** Planned date of each program day in a week: the training weekdays of that window, in order. */
export function plannedDates(startDate: string, week: number, days: readonly number[], programDays: number): string[] {
  const from = weekStart(startDate, week);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => days.includes(weekday(d)));
  // More program days than training weekdays can only happen with an inconsistent profile: pad.
  while (dates.length < programDays) dates.push(dates.at(-1) ?? from);
  return dates.slice(0, programDays);
}

export interface WeekState {
  week: number;
  /** Next program day to train this week (queue order), or null when the week is done. */
  next: { dayIdx: number; planned: string } | null;
  /** The next session's planned date has passed. */
  late: boolean;
  /** Program days still to do this week, and training days left in the window from today on. */
  remainingSessions: number;
  remainingSlots: number;
  /** Today is a planned training day for the next session. */
  dueToday: boolean;
}

/**
 * Where the owner is this week. `handled` = program-day indices done or skipped in this week.
 * Sessions follow the program order like a queue; dates are only a guide.
 */
export function weekState(o: {
  startDate: string;
  today: string;
  days: readonly number[];
  programDays: number;
  handled: ReadonlySet<number>;
}): WeekState {
  const week = Math.max(1, weekOf(o.startDate, o.today));
  const planned = plannedDates(o.startDate, week, o.days, o.programDays);
  const todo = Array.from({ length: o.programDays }, (_, i) => i).filter((i) => !o.handled.has(i));
  const end = addDays(weekStart(o.startDate, week), 6);
  let slots = 0;
  for (let d = o.today; toDay(d) <= toDay(end); d = addDays(d, 1)) if (o.days.includes(weekday(d))) slots++;
  const first = todo[0];
  if (first == null) return { week, next: null, late: false, remainingSessions: 0, remainingSlots: slots, dueToday: false };
  // The next session is due on the planned date of its queue position among what's left.
  const position = o.programDays - todo.length;
  const due = planned[position]!;
  return {
    week,
    next: { dayIdx: first, planned: due },
    late: toDay(due) < toDay(o.today),
    remainingSessions: todo.length,
    remainingSlots: slots,
    dueToday: due === o.today,
  };
}

export type RescheduleOption = 'shift' | 'merge' | 'skip';

/** Options for a late session: merge only when the rest of the week can't fit otherwise. */
export function rescheduleOptions(s: WeekState): RescheduleOption[] {
  if (!s.late || !s.next) return [];
  const opts: RescheduleOption[] = ['shift'];
  if (s.remainingSessions > Math.max(1, s.remainingSlots) && s.remainingSessions >= 2) opts.push('merge');
  opts.push('skip');
  return opts;
}

export interface MergeItem { slug: string; role: Role; sets: number; pattern: string }

/**
 * Merge two sessions into one without doubling volume (spec §8): both days' main lifts, then the
 * accessories alternating; one exercise per pattern; total sets capped at the bigger day's total
 * and at the session length (isolation trimmed first).
 */
export function mergeSessions(a: MergeItem[], b: MergeItem[], budgetMinutes: number): MergeItem[] {
  const total = (xs: MergeItem[]) => xs.reduce((s, x) => s + x.sets, 0);
  const cap = Math.max(total(a), total(b));
  const mains = [...a.filter((x) => x.role === 'main'), ...b.filter((x) => x.role === 'main')];
  const restA = a.filter((x) => x.role !== 'main'), restB = b.filter((x) => x.role !== 'main');
  const rest: MergeItem[] = [];
  for (let i = 0; i < Math.max(restA.length, restB.length); i++) {
    if (restA[i]) rest.push(restA[i]!);
    if (restB[i]) rest.push(restB[i]!);
  }
  const out: MergeItem[] = [];
  for (const x of [...mains, ...rest]) {
    if (out.some((y) => y.slug === x.slug || y.pattern === x.pattern)) continue;
    out.push({ ...x });
  }
  const min = (r: Role) => (r === 'main' ? 2 : 1);
  const over = () => total(out) > cap || sessionMinutes(out) > budgetMinutes;
  while (over()) {
    const order = (['isolation', 'accessory', 'main'] as Role[]).flatMap((r) => out.filter((x) => x.role === r).reverse());
    const cut = order.find((x) => x.sets > min(x.role));
    if (cut) { cut.sets--; continue; }
    const drop = [...out].reverse().find((x) => x.role !== 'main');
    if (!drop) break;
    out.splice(out.indexOf(drop), 1);
  }
  return out;
}
