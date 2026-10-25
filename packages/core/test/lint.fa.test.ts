import { describe, expect, it } from 'vitest';
import { fixPersian, ZWNJ } from '../src/lint/fa';
import { lintBlock } from '../src/lint/index';

const fx = (s: string, persianDigits = true) => fixPersian(s, { persianDigits }).text;
const Z = ZWNJ;

describe('fixPersian: characters', () => {
  it('replaces Arabic yeh/kaf with Persian forms', () => {
    expect(fx('كتاب علي')).toBe('کتاب علی');
    expect(fx('مصطفى')).toBe('مصطفی');
  });
});

describe('fixPersian: ZWNJ', () => {
  it('joins می/نمی prefixes written as separate words', () => {
    expect(fx('او می رود')).toBe(`او می${Z}رود`);
    expect(fx('نمی دانم')).toBe(`نمی${Z}دانم`);
    expect(fx('«می خواهم»')).toBe(`«می${Z}خواهم»`);
  });
  it('joins plural and superlative suffixes', () => {
    expect(fx('کتاب ها')).toBe(`کتاب${Z}ها`);
    expect(fx('خانه های قدیمی')).toBe(`خانه${Z}های قدیمی`);
    expect(fx('بزرگ ترین شهر')).toBe(`بزرگ${Z}ترین شهر`);
  });
  it('does not touch standalone words that only look like suffixes', () => {
    expect(fx('دست تر')).toBe('دست تر'); // «تر» = wet
    expect(fx('میز بزرگ')).toBe('میز بزرگ');
  });
  it('is idempotent and cleans broken ZWNJ', () => {
    const once = fx('می رود');
    expect(fx(once)).toBe(once);
    expect(fx(`کتاب${Z}${Z}ها`)).toBe(`کتاب${Z}ها`);
    expect(fx(`کتاب ${Z}ها`)).toBe('کتاب ها'.replace(' ', Z));
    expect(fx(`${Z}سلام${Z}`)).toBe('سلام');
  });
});

describe('fixPersian: punctuation', () => {
  it('converts Latin punctuation after Persian text', () => {
    expect(fx('سلام, دوست من; چطوری?')).toBe('سلام، دوست من؛ چطوری؟');
  });
  it('removes spaces before punctuation', () => {
    expect(fx('سلام ، دنیا .')).toBe('سلام، دنیا.');
    expect(fx('واقعاً ؟')).toBe('واقعاً؟');
  });
  it('turns quotes around Persian into guillemets without inner spaces', () => {
    expect(fx('گفت: "بیا اینجا"')).toBe('گفت: «بیا اینجا»');
    expect(fx('« سلام »')).toBe('«سلام»');
  });
  it('leaves Latin-only punctuation alone', () => {
    expect(fx('The End, finally?', false)).toBe('The End, finally?');
  });
});

describe('fixPersian: digits', () => {
  it('converts digits in body text when enabled', () => {
    expect(fx('سال 1984 بود')).toBe('سال ۱۹۸۴ بود');
    expect(fx('حدود 3.5 کیلومتر')).toBe('حدود ۳٫۵ کیلومتر');
    expect(fx('عدد ٤٥')).toBe('عدد ۴۵');
  });
  it('keeps digits when disabled, and inside Latin tokens and markers', () => {
    expect(fx('سال 1984 بود', false)).toBe('سال 1984 بود');
    expect(fx('بمب‌افکن B52 و فایل MP3')).toBe('بمب‌افکن B52 و فایل MP3');
    expect(fx('پانویس[^12] اینجا')).toBe('پانویس[^12] اینجا');
    expect(fx('ببینید https://example.com/a1')).toBe('ببینید https://example.com/a1');
  });
});

describe('fixPersian: markdown', () => {
  it('preserves inline emphasis', () => {
    expect(fx('او *می رود* و **کتاب ها**')).toBe(`او *می${Z}رود* و **کتاب${Z}ها**`);
  });
  it('preserves poem line breaks', () => {
    expect(fx('مصرع اول ,\nمصرع دوم')).toBe('مصرع اول،\nمصرع دوم');
  });
});

describe('lintBlock flags', () => {
  const base = { targetLang: 'fa', glossary: [], persianDigits: true };
  it('flags untranslated English sentences', () => {
    const r = lintBlock({ ...base, sourceText: 'He said the rain would never stop falling here.',
      translatedText: 'او گفت the rain would never stop falling here.' });
    expect(r.flags.map((f) => f.code)).toContain('untranslated_latin');
  });
  it('does not flag names or glossary terms in Latin', () => {
    const r = lintBlock({ ...base, glossary: [{ source_term: 'New York Times', target_term: 'نیویورک تایمز', locked: false }],
      sourceText: 'She read the New York Times.', translatedText: 'او نیویورک تایمز (New York Times) را خواند.' });
    expect(r.flags).toEqual([]);
  });
  it('flags abnormal length ratio', () => {
    const src = 'This is a long paragraph. '.repeat(10);
    const r = lintBlock({ ...base, sourceText: src, translatedText: 'خلاصه.' });
    expect(r.flags.map((f) => f.code)).toContain('length_ratio');
  });
  it('flags locked glossary violations, tolerating ZWNJ variants', () => {
    const glossary = [{ source_term: 'Ashwin', target_term: 'اشوین', locked: true }];
    const bad = lintBlock({ ...base, glossary, sourceText: 'Ashwin smiled.', translatedText: 'آشوین لبخند زد.' });
    expect(bad.flags.map((f) => f.code)).toContain('glossary_violation');
    const ok = lintBlock({ ...base, glossary, sourceText: 'Ashwin smiled.', translatedText: 'اشوین لبخند زد.' });
    expect(ok.flags).toEqual([]);
  });
  it('flags empty output', () => {
    expect(lintBlock({ ...base, sourceText: 'Hi.', translatedText: '  ' }).flags[0]!.code).toBe('empty_translation');
  });
});
