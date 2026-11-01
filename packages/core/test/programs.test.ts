import { describe, expect, it } from 'vitest';
import { ProgramSettingsInput } from '../src/engine/profile';
import { plannedDates, resumeShiftDays, weekday, weekOf } from '../src/engine/schedule';
import { addDays, toDay } from '../src/engine/weight';

describe('several programs', () => {
  it('a paused block resumes on the same day of the same week', () => {
    const start = '2026-09-05';
    const paused = '2026-09-14'; // day 10: week 2
    const shift = resumeShiftDays(paused, '2026-10-01');
    expect(shift).toBe(17);
    const moved = addDays(start, shift);
    expect(weekOf(moved, '2026-10-01')).toBe(weekOf(start, paused));
    expect(toDay('2026-10-01') - toDay(moved)).toBe(toDay(paused) - toDay(start));
    // The training weekdays stay the same; only their order inside the week window rotates.
    expect(plannedDates(moved, 2, [0, 2, 4], 3).map(weekday).sort()).toEqual([0, 2, 4]);
  });

  it('no shift when resumed the same day (or a clock that went backwards)', () => {
    expect(resumeShiftDays('2026-09-14', '2026-09-14')).toBe(0);
    expect(resumeShiftDays('2026-09-14', '2026-09-10')).toBe(0);
  });

  it('program settings validate like the profile ones', () => {
    const base = { trainLocation: 'gym', equipment: [], daysPerWeek: '4', sessionMinutes: '60', preferredDays: [] };
    const ok = ProgramSettingsInput.parse({ ...base, name: '  باشگاه  ' });
    expect(ok).toMatchObject({ name: 'باشگاه', daysPerWeek: 4, sessionMinutes: 60 });
    expect(ProgramSettingsInput.parse({ ...base, name: ' ' }).name).toBeUndefined();
    expect(ProgramSettingsInput.safeParse({ ...base, trainLocation: 'home' }).success).toBe(false); // home needs equipment
    expect(ProgramSettingsInput.safeParse({ ...base, preferredDays: [0, 1] }).success).toBe(false); // 2 days for a 4-day plan
    expect(ProgramSettingsInput.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
  });
});
