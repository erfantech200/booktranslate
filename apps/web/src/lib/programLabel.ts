import { fmtNum, type Digits } from './format';

type Translate = (key: 'label', values: { location: string; days: string }) => string;

/** A program's name, or (unnamed) its place and days per week. `t` = the "programs" translator. */
export function programLabel(p: { name: string | null; trainLocation: 'gym' | 'home'; daysPerWeek: number }, t: Translate, digits: Digits) {
  return p.name ?? t('label', { location: p.trainLocation, days: fmtNum(p.daysPerWeek, digits) });
}
