// Generates synthetic "phone photos" of book pages plus a scanned and a text PDF, from an
// invented book written for these tests ("The Lantern Keeper"; original text, no real book).
// Real phone photos for live evaluation go in fixtures/real/ (see fixtures/README.md).
//
//   pnpm fixtures   → fixtures/generated/*.jpg|pdf + manifest.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { chromium } from 'playwright-core';
import { fontDataUrl, FONT_FILES } from '../src/render/fonts';
import { FIXTURE_PAGES, type FixturePage } from '../test/fixtures/lanternKeeper';

const out = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'generated');
mkdirSync(out, { recursive: true });

const serif = FONT_FILES.filter((f) => f.family === 'BB Serif');
const faces = serif.map((f) => `@font-face{font-family:'Fx';src:url('${fontDataUrl(f)}');font-weight:${f.weight};font-style:${f.style}}`).join('');

const pageHtml = (p: FixturePage) => `
<div class="page">
  ${p.runningHeader ? `<div class="rh">${p.runningHeader}</div>` : ''}
  ${p.blocks.map((b) => b.type === 'heading' ? `<h1>${b.text}</h1>`
    : b.type === 'footnote' ? `<div class="fn">${b.marker} ${b.text}</div>`
    : `<p${b.noIndent ? ' class="ni"' : ''}>${b.text.replace(/\[\^(\d+)\]/g, '<sup>$1</sup>').replace(/\*([^*]+)\*/g, '<i>$1</i>')}${b.hyphenTail ?? ''}</p>`).join('')}
  <div class="num">${p.number}</div>
</div>`;

const css = `${faces}
body{margin:0;background:#3b3a36}
.page{position:relative;width:1000px;height:1450px;background:#f3ecdc;box-sizing:border-box;padding:110px 105px;font-family:'Fx';font-size:31px;line-height:1.5;color:#222}
.rh{position:absolute;top:50px;left:0;right:0;text-align:center;font-size:20px;letter-spacing:3px;color:#555}
.num{position:absolute;bottom:50px;left:0;right:0;text-align:center;font-size:22px}
h1{font-size:44px;text-align:center;margin:120px 0 70px;font-weight:400}
p{margin:0;text-indent:1.6em;text-align:justify}
p.ni{text-indent:0}
.fn{position:absolute;bottom:110px;left:105px;right:105px;font-size:22px;border-top:1px solid #999;padding-top:10px}
.spread{display:flex;gap:0;padding:40px;background:#3b3a36;width:fit-content}
.spread .page:first-child{box-shadow:inset -30px 0 40px -30px rgba(0,0,0,.35)}
.spread .page:last-child{box-shadow:inset 30px 0 40px -30px rgba(0,0,0,.35)}
.single{padding:40px;background:#3b3a36;width:fit-content}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(html: string): Promise<Buffer> {
  await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('body > div');
  return (await el!.screenshot({ type: 'png' })) as Buffer;
}

const manifest: Record<string, unknown> = {};
const byNum = new Map(FIXTURE_PAGES.map((p) => [p.number, p]));
const photo = async (name: string, png: Buffer, fx: (s: Sharp) => Sharp, pages: number[]) => {
  const jpg = await fx(sharp(png)).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(join(out, name), jpg);
  manifest[name] = { pages };
};

// Upload order and filenames deliberately disagree with page order.
await photo('IMG_2041.jpg', await shot(`<div class="single">${pageHtml(byNum.get(41)!)}</div>`), (s) => s, [41]);
await photo('IMG_2039.jpg', await shot(`<div class="single">${pageHtml(byNum.get(42)!)}</div>`), (s) => s, [42]);
await photo('IMG_2040.jpg', await shot(`<div class="spread">${pageHtml(byNum.get(43)!)}${pageHtml(byNum.get(44)!)}</div>`), (s) => s, [43, 44]);
await photo('IMG_2042.jpg', await shot(`<div class="single">${pageHtml(byNum.get(45)!)}</div>`),
  (s) => s.rotate(-4, { background: '#3b3a36' }), [45]);
await photo('IMG_2043.jpg', await shot(`<div class="single">${pageHtml(byNum.get(46)!)}</div>`), (s) => s.blur(3.2), [46]);

// Scanned PDF: page images only (no text layer).
// Sequential: shot() reuses one browser page, so concurrent renders would overwrite each other.
const scanImgs: string[] = [];
for (const n of [47, 48]) {
  scanImgs.push((await sharp(await shot(`<div class="single">${pageHtml(byNum.get(n)!)}</div>`)).greyscale().jpeg({ quality: 80 }).toBuffer()).toString('base64'));
}
await page.setContent(`<html><head><style>@page{size:A5;margin:0}body{margin:0}img{width:148mm;height:210mm;display:block;break-after:page}</style></head><body>${
  scanImgs.map((b) => `<img src="data:image/jpeg;base64,${b}">`).join('')}</body></html>`);
writeFileSync(join(out, 'scanned.pdf'), await page.pdf({ preferCSSPageSize: true }));
manifest['scanned.pdf'] = { pages: [47, 48] };

// Text PDF: real text layer.
await page.setContent(`<html><head><style>${css}@page{size:A5;margin:0}body{background:#fff}.page{width:148mm;height:210mm;padding:15mm;font-size:11pt;background:#fff;break-after:page}.rh,.num{font-size:8pt}h1{font-size:16pt;margin:20mm 0 10mm}.fn{font-size:8pt;bottom:15mm;left:15mm;right:15mm}</style></head><body>${
  [49, 50].map((n) => pageHtml(byNum.get(n)!)).join('')}</body></html>`);
writeFileSync(join(out, 'text.pdf'), await page.pdf({ preferCSSPageSize: true }));
manifest['text.pdf'] = { pages: [49, 50] };

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`fixtures written to ${out}`);
