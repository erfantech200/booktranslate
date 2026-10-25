import { isRtl, type BlockType } from '../types.js';
import { toPersianDigits } from '../lint/fa.js';

// Shared document model for every export format. Blocks become chapters (split at level-1
// headings) and footnotes are resolved and numbered per chapter. Inline markdown becomes
// XHTML-safe HTML, so the same fragments work in the PDF page and in EPUB XHTML files.

export interface RenderBlock {
  id: string;
  type: BlockType;
  level: number | null;
  /** Final text: user override ?? translation (?? source when untranslated, marked). */
  text: string;
  source_text: string;
  footnote_marker: string | null;
  page_ids: string[];
  translator_notes: string[];
  untranslated?: boolean;
}

export interface RenderBook {
  title: string;
  author: string | null;
  translator: string | null;
  lang: string;
  sourceLang: string;
  date: Date;
  blocks: RenderBlock[];
}

export interface Chapter {
  id: string;
  index: number;
  title: string | null;
  titleHtml: string | null;
  bodyHtml: string;
  notesHtml: string;
  headings: { id: string; level: number; text: string }[];
}

export interface BuiltDocument {
  lang: string;
  dir: 'rtl' | 'ltr';
  title: string;
  chapters: Chapter[];
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Inline markdown → HTML (escaped). Supports **bold**, *italic*, and Latin-run isolation in RTL text. */
export function inlineHtml(md: string, opts: { rtl: boolean; sourceLang: string }): string {
  let s = escapeXml(md);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  if (opts.rtl) {
    // Isolate embedded Latin runs so neighbouring punctuation and numbers stay in place.
    s = s.replace(/(?<![\w;&#^])([A-Za-z][A-Za-z0-9'’.\-]*(?:[ ,:&][A-Za-z0-9][A-Za-z0-9'’.\-]*)*)(?![^<]*>)/g,
      (m) => `<span dir="ltr" lang="${opts.sourceLang}">${m}</span>`);
  }
  return s;
}

function tableHtml(md: string, inl: (s: string) => string): string {
  const rows = md.trim().split('\n').filter((r) => r.includes('|'));
  const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isSep = (r: string) => /^\s*\|?\s*:?-{2,}/.test(r);
  const head = rows[0] && rows[1] && isSep(rows[1]) ? cells(rows[0]) : null;
  const body = rows.slice(head ? 2 : 0).filter((r) => !isSep(r));
  return `<table>${head ? `<thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${
    body.map((r) => `<tr>${cells(r).map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const formatNum = (n: number, lang: string) => (lang === 'fa' ? toPersianDigits(n) : String(n));

export function buildDocument(book: RenderBook): BuiltDocument {
  const rtl = isRtl(book.lang);
  const inl = (s: string) => inlineHtml(s, { rtl, sourceLang: book.sourceLang });

  // Split into chapters at level-1 headings (or level-2 if the book has none).
  const minLevel = Math.min(...book.blocks.filter((b) => b.type === 'heading').map((b) => b.level ?? 9), 9);
  const chapterLevel = minLevel <= 2 ? minLevel : 1;
  const groups: RenderBlock[][] = [];
  for (const b of book.blocks) {
    if (b.type === 'heading' && (b.level ?? 9) <= chapterLevel || groups.length === 0) groups.push([]);
    groups[groups.length - 1]!.push(b);
  }

  const chapters: Chapter[] = groups.map((blocks, ci) => {
    const id = `ch${ci + 1}`;
    const head = blocks[0]?.type === 'heading' && (blocks[0].level ?? 9) <= chapterLevel ? blocks[0] : null;
    const footnoteBlocks = blocks.filter((b) => b.type === 'footnote');
    const usedFootnotes = new Set<string>();
    const notes: { n: number; html: string }[] = [];
    const noteId = (n: number) => `${id}-fn${n}`;
    const ref = (n: number) =>
      `<sup class="fnref"><a epub:type="noteref" href="#${noteId(n)}" id="${noteId(n)}-ref">${formatNum(n, book.lang)}</a></sup>`;

    const resolveMarkers = (b: RenderBlock, html: string) =>
      html.replace(/\[\^([^\]\s]+)\]/g, (_, marker: string) => {
        const fn = footnoteBlocks.find((f) => f.footnote_marker === marker && !usedFootnotes.has(f.id)
          && f.page_ids.some((p) => b.page_ids.includes(p)))
          ?? footnoteBlocks.find((f) => f.footnote_marker === marker && !usedFootnotes.has(f.id));
        if (!fn) return '';
        usedFootnotes.add(fn.id);
        const n = notes.length + 1;
        notes.push({ n, html: inl(fn.text) });
        return ref(n);
      });
    const withTranslatorNotes = (b: RenderBlock, html: string) => {
      let out = html;
      for (const note of b.translator_notes) {
        const n = notes.length + 1;
        notes.push({ n, html: `${inl(note)}${book.lang === 'fa' ? ' —م.' : ' —Trans.'}` });
        out += ref(n);
      }
      return out;
    };

    const headings: Chapter['headings'] = [];
    const parts: string[] = [];
    let list: string[] | null = null;
    const flushList = () => {
      if (list) parts.push(`<ul>${list.join('')}</ul>`);
      list = null;
    };
    blocks.forEach((b, bi) => {
      if (b.type === 'footnote') return;
      const attrs = ` id="b-${b.id}"${b.untranslated ? ' class="untranslated"' : ''}`;
      const inner = (t: string) => withTranslatorNotes(b, resolveMarkers(b, inl(t)));
      if (b.type !== 'list_item') flushList();
      switch (b.type) {
        case 'heading': {
          if (b === head) break;
          const level = Math.min(4, Math.max(2, (b.level ?? 2) + (chapterLevel === 1 ? 0 : 1)));
          const hid = `${id}-h${bi}`;
          headings.push({ id: hid, level, text: b.text.replace(/\*+/g, '') });
          parts.push(`<h${level} id="${hid}">${inner(b.text)}</h${level}>`);
          break;
        }
        case 'list_item':
          (list ??= []).push(`<li${attrs}>${inner(b.text.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`);
          break;
        case 'quote':
          parts.push(`<blockquote${attrs}><p>${inner(b.text)}</p></blockquote>`);
          break;
        case 'poem':
          parts.push(`<div class="poem"${attrs}>${b.text.split('\n').map((l) => `<p class="verse">${inner(l)}</p>`).join('')}</div>`);
          break;
        case 'caption':
          parts.push(`<p class="caption"${attrs.replace(' class="untranslated"', '')}>${inner(b.text)}</p>`);
          break;
        case 'table':
          parts.push(`<div class="table"${attrs}>${tableHtml(b.text, (c) => withTranslatorNotes(b, resolveMarkers(b, inl(c))))}</div>`);
          break;
        default:
          parts.push(`<p${attrs}>${inner(b.text)}</p>`);
      }
    });
    flushList();
    // Footnotes that no marker pointed at still belong in the chapter notes.
    for (const f of footnoteBlocks) {
      if (usedFootnotes.has(f.id)) continue;
      notes.push({ n: notes.length + 1, html: inl(f.text) });
    }

    const notesHtml = notes.length
      ? `<section class="notes" epub:type="footnotes">${notes.map((n) =>
          `<aside epub:type="footnote" class="note" id="${noteId(n.n)}"><p><a class="note-num" href="#${noteId(n.n)}-ref">${formatNum(n.n, book.lang)}</a>${book.lang === 'fa' ? '. ' : '. '}${n.html}</p></aside>`).join('')}</section>`
      : '';
    return {
      id,
      index: ci,
      title: head ? head.text.replace(/\*+/g, '') : null,
      titleHtml: head ? inl(head.text) : null,
      bodyHtml: parts.join('\n'),
      notesHtml,
      headings,
    };
  });

  return { lang: book.lang, dir: rtl ? 'rtl' : 'ltr', title: book.title, chapters };
}

export { formatNum };
