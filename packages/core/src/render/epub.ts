import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { buildDocument, escapeXml, type BuiltDocument, type RenderBook } from './document';
import { FONT_FILES, fontBytes } from './fonts';
import { bookCss, frontMatterStrings } from './pdf';

// EPUB 3: one XHTML file per chapter, nav TOC, embedded fonts, popup footnotes
// (epub:type="noteref" → <aside epub:type="footnote">), RTL page progression for RTL targets.

const xhtml = (doc: BuiltDocument, title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${doc.lang}" lang="${doc.lang}" dir="${doc.dir}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="book.css"/>
</head>
<body dir="${doc.dir}">
${body}
</body>
</html>
`;

/** HTML5 void elements → XHTML self-closing (the document builder emits none, but stay safe). */
const toXhtml = (html: string) => html.replace(/<(br|hr|img)([^>]*?)(?<!\/)>/g, '<$1$2/>');

export async function renderEpub(book: RenderBook, o: { bodyFont: 'naskh' | 'vazirmatn'; fontSizePt: number; identifier?: string }): Promise<Buffer> {
  const doc = buildDocument(book);
  const s = frontMatterStrings(book);
  const id = o.identifier ?? `urn:uuid:${randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const css = bookCss(doc, book, { pageSize: 'A5', bodyFont: o.bodyFont, fontSizePt: o.fontSizePt, grayscale: false }, 'epub')
    + `
body { margin: 0 4%; }
.title-page { text-align: center; margin-top: 30%; }
.title-page .title { font-size: 2em; font-weight: 700; color: var(--accent); }
.title-page .author { font-size: 1.2em; margin-top: 0.8em; }
.title-page .translator { margin-top: 2em; }
.title-page .date { color: var(--muted); font-size: 0.9em; }
.chapter h1 { margin-top: 1.5em; }
aside.note { display: block; }
nav#toc ol { list-style: none; padding-inline-start: 1em; }
`;

  const zip = new JSZip();
  // The mimetype file must come first and be stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  zip.file('OEBPS/book.css', css);
  for (const f of FONT_FILES) zip.file(`OEBPS/fonts/${f.file}`, fontBytes(f));

  zip.file('OEBPS/title.xhtml', xhtml(doc, book.title, `<section class="title-page" epub:type="titlepage">
<h1 class="title">${escapeXml(book.title)}</h1>
${s.authorLine ? `<p class="author">${escapeXml(s.authorLine)}</p>` : ''}
${s.translatorLine ? `<p class="translator">${escapeXml(s.translatorLine)}</p>` : ''}
<p class="date">${escapeXml(s.date)}</p>
</section>`));

  const chapterFiles = doc.chapters.map((c) => ({ c, file: `${c.id}.xhtml` }));
  for (const { c, file } of chapterFiles) {
    zip.file(`OEBPS/${file}`, xhtml(doc, c.title ?? book.title, toXhtml(`<section class="chapter" epub:type="chapter" id="${c.id}">
${c.titleHtml ? `<h1>${c.titleHtml}</h1>` : ''}
${c.bodyHtml}
${c.notesHtml}
</section>`)));
  }

  const navItems = chapterFiles.map(({ c, file }, i) => {
    const subs = c.headings.filter((h) => h.level === 2);
    const label = c.title ?? (book.lang === 'fa' ? `بخش ${i + 1}` : `Part ${i + 1}`);
    return `<li><a href="${file}">${escapeXml(label)}</a>${subs.length
      ? `<ol>${subs.map((h) => `<li><a href="${file}#${h.id}">${escapeXml(h.text)}</a></li>`).join('')}</ol>` : ''}</li>`;
  }).join('\n');
  zip.file('OEBPS/nav.xhtml', xhtml(doc, s.toc, `<nav epub:type="toc" id="toc"><h1>${escapeXml(s.toc)}</h1><ol>
<li><a href="title.xhtml">${escapeXml(book.title)}</a></li>
${navItems}
</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><ol>
<li><a epub:type="titlepage" href="title.xhtml">${escapeXml(book.title)}</a></li>
${chapterFiles[0] ? `<li><a epub:type="bodymatter" href="${chapterFiles[0].file}">${escapeXml(chapterFiles[0].c.title ?? book.title)}</a></li>` : ''}
</ol></nav>`));

  const rtl = doc.dir === 'rtl';
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${doc.lang}" dir="${doc.dir}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${doc.lang}</dc:language>
    ${book.author ? `<dc:creator id="author">${escapeXml(book.author)}</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>` : ''}
    ${book.translator ? `<dc:contributor id="translator">${escapeXml(book.translator)}</dc:contributor>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="book.css" media-type="text/css"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${chapterFiles.map(({ c, file }) => `    <item id="${c.id}" href="${file}" media-type="application/xhtml+xml"/>`).join('\n')}
${FONT_FILES.map((f, i) => `    <item id="font${i}" href="fonts/${f.file}" media-type="font/woff2"/>`).join('\n')}
  </manifest>
  <spine${rtl ? ' page-progression-direction="rtl"' : ''}>
    <itemref idref="title"/>
${chapterFiles.map(({ c }) => `    <itemref idref="${c.id}"/>`).join('\n')}
  </spine>
</package>
`);

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
