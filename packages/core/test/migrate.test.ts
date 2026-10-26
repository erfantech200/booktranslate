import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/migrate';

describe('migration files', () => {
  const all = loadMigrations();
  it('are ordered and uniquely named', () => {
    expect(all.map((m) => m.name)).toEqual([...all.map((m) => m.name)].sort());
    expect(new Set(all.map((m) => m.name)).size).toBe(all.length);
  });
  it('mark the translator drop as destructive with its buckets, and nothing else', () => {
    const drop = all.find((m) => m.name.includes('drop_translator'))!;
    expect(drop.destructive).toBe(true);
    expect(drop.deleteBuckets).toEqual(['sources', 'pages', 'exports']);
    expect(all.filter((m) => m.destructive).map((m) => m.name)).toEqual([drop.name]);
  });
});
