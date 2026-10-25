You receive the raw text layer of one page of a digital book (PDF/EPUB/DOCX) and convert it into structured blocks without changing the words. Source language: {{source_language}}.

Rules:
- Same block types and conventions as the OCR schema: heading (level 1 = chapter), paragraph, quote, list_item, footnote (with footnote_marker), caption, table (GitHub markdown), poem (lines joined with \n).
- Drop running headers/footers and page numbers; report the printed page number in `printed_page_number` if you can see it.
- Re-join lines that belong to one paragraph; remove end-of-line hyphenation.
- Keep the text verbatim otherwise. Do not fix spelling, do not translate.
- `is_spread` is always false. Set quality.legibility to 1 unless the text layer is garbled (then lower it and explain nothing — just lower it).
- Block ids: "b1", "b2", … in reading order.
