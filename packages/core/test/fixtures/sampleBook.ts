import type { RenderBook } from '../../src/render/document.js';

// Original sample text written for these tests (not taken from any book).
export function sampleBook(): RenderBook {
  const b = (id: string, type: any, text: string, extra: Partial<RenderBook['blocks'][number]> = {}) => ({
    id, type, level: null, text, source_text: text, footnote_marker: null, page_ids: ['p1'], translator_notes: [], ...extra,
  });
  return {
    title: 'باغ زمستانی',
    author: 'نویسندهٔ آزمایشی',
    translator: 'ارفان',
    lang: 'fa',
    sourceLang: 'en',
    date: new Date('2026-10-25T00:00:00Z'),
    blocks: [
      b('h1', 'heading', 'فصل یکم: ایستگاه', { level: 1 }),
      b('p1', 'paragraph', 'قطار ساعت ۶ صبح رسید و مه هنوز روی سکو مانده بود. مینا چمدانش را برداشت و به ساعت بزرگ ایستگاه نگاه کرد؛ عقربه‌ها از شب قبل تکان نخورده بودند.[^1]'),
      b('p2', 'paragraph', 'مردی با کت خاکستری کنار باجه ایستاده بود و روزنامهٔ *Morning Post* را ورق می‌زد. وقتی مینا نزدیک شد، سرش را بلند کرد و گفت: «دیر کردید.»', { translator_notes: ['روزنامه‌ای خیالی در داستان.'] }),
      b('f1', 'footnote', 'این ساعت در سال ۱۹۱۲ ساخته شده بود.', { footnote_marker: '1' }),
      b('h2', 'heading', 'نامه', { level: 2 }),
      b('q1', 'quote', 'هر کس این نامه را پیدا کرد، آن را به باغ زمستانی برگرداند.'),
      b('poem', 'poem', 'برف آمد و راه را پوشاند\nو هیچ‌کس نام ما را نخواند'),
      b('l1', 'list_item', 'یک کلید برنجی'),
      b('l2', 'list_item', 'دو بلیت قطار'),
      ...Array.from({ length: 14 }, (_, i) => b(`x${i}`, 'paragraph',
        'آن‌ها از خیابان‌های باریک گذشتند و صدای قدم‌هایشان روی سنگفرش خیس می‌پیچید. مینا هر چند قدم یک بار برمی‌گشت تا مطمئن شود کسی دنبالشان نمی‌آید، اما خیابان خالی بود و فقط نور زرد چراغ‌ها روی دیوارها می‌لرزید. نسخهٔ ۲.۰ نقشه را در جیبش داشت.')),
      b('h3', 'heading', 'فصل دوم: باغ', { level: 1 }),
      b('p3', 'paragraph', 'در باغ، درخت‌ها زیر برف خم شده بودند و حوض یخ زده بود.'),
    ],
  };
}
