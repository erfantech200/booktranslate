import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { BODY_AREAS } from '../src/engine/profile';
import { EXTRA_EQUIPMENT, MUSCLES, PATTERNS, TRACKED_MUSCLES } from '../src/engine/library';
import { EQUIPMENT } from '../src/engine/profile';

const slugs = new Set(EXERCISES.map((e) => e.slug));
const persian = /[؀-ۿ]/;

describe('exercise seed', () => {
  it('has about 70+ exercises with unique slugs', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(70);
    expect(slugs.size).toBe(EXERCISES.length);
    for (const e of EXERCISES) expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('covers every movement pattern and tracked muscle', () => {
    for (const p of PATTERNS) expect(EXERCISES.some((e) => e.pattern === p), p).toBe(true);
    for (const m of TRACKED_MUSCLES) expect(EXERCISES.some((e) => e.primary.includes(m)), m).toBe(true);
  });

  it('has complete Persian coaching content for every exercise', () => {
    for (const e of EXERCISES) {
      const where = e.slug;
      expect(e.nameFa, where).toMatch(persian);
      expect(e.setup.length, where).toBeGreaterThanOrEqual(1);
      expect(e.execution.length, where).toBeGreaterThanOrEqual(2);
      expect(e.cues.length, where).toBeGreaterThanOrEqual(3);
      expect(e.cues.length, where).toBeLessThanOrEqual(5);
      expect(e.mistakes.length, where).toBeGreaterThanOrEqual(2);
      expect(e.safety.length, where).toBeGreaterThanOrEqual(1);
      for (const s of [...e.setup, ...e.execution, ...e.cues, ...e.safety, e.breathing, e.tempo, ...e.mistakes.flatMap((m) => [m.mistake, m.fix])]) {
        expect(s.trim().length, where).toBeGreaterThan(2);
        expect(s, where).toMatch(persian);
        // Numbers in content would ignore the digits setting: write them as words.
        expect(s, `${where}: ${s}`).not.toMatch(/[0-9۰-۹]/);
      }
    }
  });

  it('uses only known enums and valid ranges', () => {
    const equip = new Set<string>([...EQUIPMENT, ...EXTRA_EQUIPMENT]);
    for (const e of EXERCISES) {
      for (const m of [...e.primary, ...e.secondary]) expect(MUSCLES as readonly string[], e.slug).toContain(m);
      expect(e.primary.length, e.slug).toBeGreaterThan(0);
      for (const set of e.equipment) for (const item of set) expect(equip.has(item), `${e.slug}: ${item}`).toBe(true);
      for (const a of [...e.contraindications, ...e.cautions]) expect(BODY_AREAS as readonly string[], e.slug).toContain(a);
      expect(e.reps[0], e.slug).toBeLessThan(e.reps[1]);
      expect(e.restSec, e.slug).toBeGreaterThanOrEqual(30);
    }
  });

  it('references only existing exercises', () => {
    for (const e of EXERCISES) {
      for (const s of [...e.regressions, ...e.progressions, ...e.substitutes]) {
        expect(slugs.has(s), `${e.slug} → ${s}`).toBe(true);
        expect(s, e.slug).not.toBe(e.slug);
      }
    }
  });

  it('follows the spec on lower-back contraindications', () => {
    const bySlug = new Map(EXERCISES.map((e) => [e.slug, e]));
    for (const s of ['conventional-deadlift', 'good-morning']) expect(bySlug.get(s)!.contraindications).toContain('lower_back');
    for (const s of ['hip-thrust', 'back-extension', 'romanian-deadlift']) expect(bySlug.get(s)!.contraindications).not.toContain('lower_back');
  });
});
