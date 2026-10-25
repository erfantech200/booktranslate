'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

// Only plain text structure is carried over from the EPUB's XHTML; everything else is unwrapped
// or dropped, so nothing in the file can run or load anything in the app.
const KEEP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'section', 'nav', 'ol', 'ul', 'li', 'em', 'strong', 'i', 'b',
  'sup', 'sub', 'blockquote', 'hr', 'br', 'span', 'div', 'aside', 'small', 'header', 'footer', 'figure', 'figcaption', 'table',
  'thead', 'tbody', 'tr', 'td', 'th']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math', 'video', 'audio', 'link', 'meta', 'title', 'head', 'form', 'input', 'button']);
const ATTRS = ['dir', 'lang'];

function copyClean(from: Node, to: Node) {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(child.textContent ?? '')); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.localName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (!KEEP.has(tag)) { copyClean(el, to); continue; } // e.g. <a>: keep its text, not the link
    const out = document.createElement(tag);
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v) out.setAttribute(a, v); }
    if ((el.getAttribute('epub:type') ?? el.getAttribute('class') ?? '').includes('footnote')) out.setAttribute('data-note', '');
    copyClean(el, out);
    to.appendChild(out);
  }
}

/** Reads the EPUB in the browser (JSZip) and shows its chapters in reading order. */
export function EpubPreview({ url }: { url: string }) {
  const t = useTranslations('preview');
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: JSZip } = await import('jszip');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
      const container = xml(await zip.file('META-INF/container.xml')!.async('string'));
      const opfPath = container.querySelector('rootfile')!.getAttribute('full-path')!;
      const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const opf = xml(await zip.file(opfPath)!.async('string'));
      const hrefs = new Map(Array.from(opf.querySelectorAll('manifest > item')).map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
      const frag = document.createDocumentFragment();
      for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
        const href = hrefs.get(ref.getAttribute('idref'));
        const file = href && zip.file(base + decodeURIComponent(href));
        if (!file) continue;
        const page = new DOMParser().parseFromString(await file.async('string'), 'application/xhtml+xml');
        const section = document.createElement('section');
        for (const a of ATTRS) { const v = page.documentElement.getAttribute(a); if (v) section.setAttribute(a, v); }
        if (page.body) copyClean(page.body, section);
        frag.appendChild(section);
      }
      if (cancelled || !host.current) return;
      host.current.replaceChildren(frag);
      setState('ready');
    })().catch((e) => { console.error(e); if (!cancelled) setState('failed'); });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div className="space-y-4">
      <p className="note note-done">{t('epubNote')}</p>
      {state === 'loading' && <p role="status" className="text-muted">{t('loading')}</p>}
      {state === 'failed' && <p role="alert" className="note note-alert">{t('failed')}</p>}
      <div ref={host} className="epub-preview sheet mx-auto max-w-[40rem] px-6 py-8 sm:px-10" hidden={state !== 'ready'} />
    </div>
  );
}
