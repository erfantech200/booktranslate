import { createHash } from 'node:crypto';
import type { ModelTransport, TransportRequest, TransportResponse } from '../src/openai/structured';
import type { PageExtraction } from '../src/types';
import { FIXTURE_GLOSSARY, FIXTURE_PAGES, type FixturePage } from './fixtures/lanternKeeper';

// Deterministic stand-in for the OpenAI transport in the golden pipeline test. It "reads" page
// images by looking up the sha256 of the exact image bytes the pipeline sends (the test
// precomputes them with the same normalize/split functions), "structures" text layers by
// matching fixture text, and "translates" into deterministic pseudo-Persian.

const FA_LETTERS = 'ابپتسجچحخدرزژشصطعفقکگلمنوهی';
export function pseudoPersian(text: string, glossary: { source_term: string; target_term: string }[]): string {
  let s = text;
  for (const g of [...glossary].sort((a, b) => b.source_term.length - a.source_term.length)) {
    s = s.split(g.source_term).join(`\u0000${g.target_term}\u0001`);
  }
  return s.replace(/[A-Za-z’']+(?![^\u0000]*\u0001)/g, (w) =>
    [...w].map((c, i) => FA_LETTERS[(c.charCodeAt(0) + i) % FA_LETTERS.length]).join(''))
    .replace(/[\u0000\u0001]/g, '');
}

const usage = (inp: number, out: number) => ({ inputTokens: inp, cachedTokens: Math.floor(inp / 3), cacheWriteTokens: 0, outputTokens: out, reasoningTokens: Math.floor(out / 4) });

function extractionFor(pages: FixturePage[], spread: boolean): PageExtraction {
  const p = pages[0]!;
  let n = 0;
  return {
    printed_page_number: p.number,
    is_spread: spread,
    quality: p.number === 46
      ? { legibility: 0.5, blur: true, glare: false, cut_off: false }
      : { legibility: 0.97, blur: false, glare: false, cut_off: false },
    blocks: pages.flatMap((pg) => pg.blocks.map((b) => ({
      id: `b${++n}`,
      type: b.type,
      level: b.type === 'heading' ? 1 : null,
      text: b.text,
      footnote_marker: b.marker ?? null,
      starts_mid_sentence: !!b.startsMid,
      ends_mid_sentence: !!b.endsMid,
    }))),
  };
}

export class FakeTransport implements ModelTransport {
  calls: { schemaName: string; model: string; cacheKey?: string }[] = [];
  constructor(private imagePages: Map<string, { pages: number[]; spread: boolean }>) {}

  async create(req: TransportRequest): Promise<TransportResponse> {
    this.calls.push({ schemaName: req.schemaName, model: req.model, cacheKey: req.cacheKey });
    const msg = req.input[0]!;
    const parts = typeof msg.content === 'string' ? [{ type: 'input_text', text: msg.content } as const] : msg.content;
    const text = parts.filter((p) => p.type === 'input_text').map((p: any) => p.text).join('\n');
    const image = parts.find((p) => p.type === 'input_image') as { image_url: string } | undefined;
    const ok = (json: unknown, u = usage(2000, 400)): TransportResponse => ({ json, refusal: null, incomplete: null, requestId: 'fake', usage: u });

    if (req.schemaName === 'page_extraction' && image) {
      const bytes = Buffer.from(image.image_url.split(',')[1]!, 'base64');
      const hit = this.imagePages.get(createHash('sha256').update(bytes).digest('hex'));
      if (!hit) throw new Error('fake OCR: unknown image');
      return ok(extractionFor(hit.pages.map((n) => FIXTURE_PAGES.find((p) => p.number === n)!), hit.spread), usage(1700, 500));
    }
    if (req.schemaName === 'page_extraction') {
      const flat = text.replace(/\s+/g, ' ');
      const page = FIXTURE_PAGES.find((p) => flat.includes(p.blocks[0]!.text.slice(0, 30)));
      if (!page) throw new Error('fake structure: unknown text');
      return ok(extractionFor([page], false), usage(600, 400));
    }
    if (req.schemaName === 'glossary') {
      return ok({
        brief: { genre: 'literary fiction', era: 'unspecified, early 20th century feel', narrator_pov: 'third person limited',
          tone: 'quiet, restrained', audience: 'adult', summary_for_translator: 'A lighthouse keeper receives a letter from her estranged brother and travels to see him.' },
        terms: FIXTURE_GLOSSARY,
      }, usage(4000, 600));
    }
    if (req.schemaName === 'translation') {
      const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
      const items = JSON.parse(json) as { id: string; text: string }[];
      // Use the glossary actually sent in the prompt (so glossary edits are honoured).
      const glossary = [...req.instructions.matchAll(/^- (.+?) → (.+?)(?: \[LOCKED\])? \(/gm)]
        .map((m) => ({ source_term: m[1]!, target_term: m[2]! }));
      return ok({
        translations: items.map((i) => ({ id: i.id, text: pseudoPersian(i.text, glossary) })),
        translator_notes: [],
      }, usage(Math.round(3000 + text.length / 4), items.length * 120));
    }
    throw new Error(`fake transport: unexpected ${req.schemaName}`);
  }
}
