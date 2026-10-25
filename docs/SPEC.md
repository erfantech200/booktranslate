# Project: Bookbridge (working name) — AI book translation web app

Build a production-quality web app that translates books (phone photos of paper pages, PDFs, ebooks) into another language using the OpenAI API, with Persian (fa) as the first-class target, and exports clean, readable, print-ready files.

First user is me. My workflow: I read English paper books, photograph ~20 pages with my phone, upload them, and want back a clean Persian translation I can print or read on my phone. Then I do the next 20 pages of the same book. Build for this workflow first, but structure everything (user_id on every row, RLS) so it can become a multi-user product later.

## Before writing code
1. Save this spec as `docs/SPEC.md` and create `CLAUDE.md` (stack, commands, conventions, hard rules).
2. Check OpenAI's current API docs (models, Responses API, Structured Outputs, Batch API, prompt caching, reasoning effort) and confirm exact model IDs and parameter names. Do not rely on memory.
3. Propose the repo structure and Phase 1 plan in a few lines, then build. Ask me only if genuinely blocked.

## Stack
- pnpm monorepo, TypeScript everywhere:
  - `apps/web`: Next.js App Router + Tailwind, deployed on Vercel. UI in Persian (RTL, default) and English (next-intl).
  - `apps/worker`: long-running Node worker in Docker (Railway or Fly.io). Runs the whole pipeline. Image includes Playwright Chromium, poppler-utils, libheif, and the fonts.
  - `packages/core`: shared types, DB access, OpenAI client, prompts, pipeline stages, renderers.
- Supabase: Postgres, private Storage buckets (signed URLs), Auth with Google OAuth. Phase 1: allowlist my email only.
- Job queue: a `jobs` table polled by the worker with `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction (no LISTEN/NOTIFY, so it works through the Supabase transaction pooler). Exponential backoff, `run_after`, max attempts, idempotent stages.
- Official `openai` Node SDK (latest), Responses API, Structured Outputs (JSON schema) for every model call, validated with zod.

## Models (env/config only, never hardcoded in logic)
- `OCR_MODEL=gpt-6-luna`: cheap vision model for page extraction.
- `TRANSLATION_MODEL=gpt-6.1-sol`: default translator.
- `PREMIUM_TRANSLATION_MODEL`: GPT-6 Astra (look up its exact ID), optional "best quality" mode.
- Reasoning effort configurable per stage. Start low for OCR, medium for translation, and tune on fixtures.
- Settings: "compare models on this page", which translates one page with 2–3 models side by side so I can choose.

## Inputs
- Images: JPG, PNG, WEBP, HEIC/HEIF (iPhone). Bulk upload of 20–50 at once (drag & drop on desktop, multi-select on mobile).
- In-app camera capture mode (mobile PWA): shoot pages one after another, background upload, thumbnail strip with retake/delete/reorder.
- PDF (text-based and scanned; detect per page whether a usable text layer exists), EPUB, DOCX, TXT/MD.
- Preprocessing with `sharp`: EXIF auto-rotate, HEIC→JPEG (prebuilt sharp may lack HEVC; use libheif or heic-convert), resize to the model's optimal resolution, light contrast normalization. Keep originals.
- Two-page spreads: if one photo contains two pages, split them and order them by the source language's reading direction.
- Page order: by detected printed page number, falling back to EXIF time and then filename. Drag-to-reorder in the UI.

## Core concept: Book → Batches → Pages → Blocks
A Book persists across many uploads. Each upload is a Batch appended to the book. Page order, glossary, style and chapter structure continue across batches. Export scope: whole book, chapter, batch, or page range.

## Pipeline (resumable stages, live per-page status in the UI)
1. Ingest & normalize (above).
2. Extract:
   - Photos/scanned pages → OCR_MODEL with this Structured Output: `{ printed_page_number, is_spread, blocks: [{ id, type: heading|paragraph|quote|list_item|footnote|caption|table|poem, level, text (inline markdown for italic/bold), starts_mid_sentence, ends_mid_sentence }], quality: { legibility: 0-1, cut_off, blur, glare } }`.
   - Drop running headers/footers and page numbers. Remove end-of-line hyphenation. Link footnotes to their markers.
   - Text-layer PDF/EPUB/DOCX → extract text directly (no OCR), then a cheap structuring pass into the same block schema.
3. Stitch: merge paragraphs split across page boundaries, keeping page provenance on every block.
4. Quality gate, run before translating, with warnings I can act on: missing pages (gaps in page numbers), duplicate pages, and blurry, cut-off or glare pages. Each shows a "retake this page" prompt with the thumbnail highlighted.
5. Book brief & glossary (built on the first batch, updated on later ones):
   - Brief: genre, era, narrator POV, tone, audience.
   - Glossary: characters, places, organizations, invented and recurring terms, each with a proposed rendering. Editable in the UI; "locked" terms are mandatory.
6. Translate:
   - Chunk by whole blocks (~1,500–2,500 source tokens; never split a paragraph). Output is a Structured Output array keyed by block id. This 1:1 alignment drives bilingual export and per-block editing.
   - Prompt order for caching: static system prompt → language style guide → book brief → glossary (stable prefix), then the previous 2–3 translated blocks as context, then the chunk.
   - Configurable concurrency with 429/5xx backoff.
   - Two modes: "Fast" (normal API) and "Cheap" (Batch API, ~50% cheaper, results within 24h; the worker polls batch status).
7. Post-process & lint (deterministic, per target language). Apply only safe auto-fixes and flag the rest. For Persian:
   - Arabic ي/ك → Persian ی/ک.
   - ZWNJ (U+200C) for می/نمی prefixes and common suffixes (ها، های، ترین، ...).
   - Persian punctuation ، ؛ ؟ « », with no space before punctuation.
   - Persian digits in body text (setting).
   - Flags: untranslated Latin sentences (except names), abnormal length ratio, missing blocks, glossary violations. Auto-retry once, then mark for review.
8. Render exports. Cache outputs; re-render only when content hashes change.

## Translation rules (versioned prompt files in packages/core/prompts/)
General:
- Faithful and complete: no omissions, additions or summarizing.
- Natural, fluent prose, not word-for-word. Preserve the author's voice, tone, humor and register.
- Idioms become natural target-language equivalents.
- Keep structure: headings, emphasis, lists, footnotes, poems line by line.

Persian style guide:
- Smooth literary standard Persian that reads like a professionally published translation.
- Dialogue register is a book setting: formal written vs. natural spoken. Keep تو/شما consistent per character relationship.
- Names follow the glossary. Optionally show the original Latin in parentheses at first occurrence.
- Optional translator's notes for cultural references, rendered as footnotes ending with «—م.».
- Keep units, currencies and dates as in the original.

Other targets: the general rules plus a short per-language style file. RTL is automatic for fa, ar, he and ur.

## Exports
- PDF (print-ready), rendered HTML → PDF with Playwright Chromium:
  - Page sizes: A4, A5, رقعی (14.5×21 cm), وزیری (17×24 cm), US Letter. Mirrored margins with an inner gutter for duplex printing.
  - Structure: title page (title, author, translator line, date), TOC from detected headings, chapters start on a new page, running header, page numbers (Persian digits for fa via `counter(page, persian)`).
  - Footnotes at the end of each chapter by default; at the bottom of the page only if reliable (Paged.js fallback).
  - Typography: embedded fonts. A Naskh body font (e.g. Noto Naskh Arabic) with Vazirmatn as the sans option, selectable size. Persian line-height ~1.9, justified text, no orphaned headings, correct bidi for embedded Latin words and numbers.
  - Use CSS @page margin boxes; fall back to Paged.js if needed.
  - Grayscale print mode.
- EPUB 3 for phone readers: `dir="rtl"`, `xml:lang`, `page-progression-direction="rtl"`, embedded fonts, nav TOC, popup footnotes. Validate with epubcheck in tests.
- DOCX via the `docx` lib with RTL/bidi paragraphs, plus HTML and Markdown.
- Bilingual edition: paragraph-by-paragraph (original then translation), or two columns side by side in PDF.

## Web reader (PWA)
- Continuous scroll, font and size choice, line height, light/sepia/dark themes.
- Remembers reading position per book. Works offline once a book is opened.
- Tap a paragraph to see its original text and source page photo, edit the translation inline, or "retranslate this paragraph" with an optional instruction.
- User edits are stored as overrides and never overwritten by re-runs.

## Screens
Library (book cards: cover from the first page photo, progress, cost) · Book (batches, upload/capture, live per-page status, warnings, export) · Review (page photo | extracted text | translation, stacked on mobile) · Glossary & book settings · Usage & costs. Mobile-first, RTL-correct, clean reading-focused design.

## Cost control
- Estimate tokens and $ before each run, split into OCR vs. translation and Fast vs. Cheap.
- Log usage per call (input, cached, output, reasoning tokens). Compute cost from a prices config file.
- Per-book and monthly budget caps; jobs pause when a cap is hit.
- Never re-OCR or re-translate unchanged content (content hashes).

## Data model
Tables: books, batches, pages, blocks (source_text, translated_text, user_override, page provenance), glossary_terms, jobs, exports, usage_log. Use SQL migrations with RLS on every table.

## Hard rules
- No keys in code. Use `.env.local` and platform secrets, and provide `.env.example`.
- All files live in private storage behind short-lived signed URLs. Option to delete source photos after a batch completes.
- Model IDs, prices and prompts are config, not code.
- Every model call uses Structured Outputs plus zod validation. On invalid output, retry once, then flag.
- No fake progress. Show real per-page status and real costs.

## Phases (each shipped end-to-end and deployed)
- Phase 1 (MVP for me): allowlist auth → create book → upload photos/PDF → OCR → stitch → auto glossary (editable) → translate (Fast) → Persian lint → PDF (A4/A5) + EPUB → per-page status and cost.
- Phase 2: web reader with inline edit/retranslate, camera capture, quality gate, Cheap/Batch mode, bilingual export, DOCX, رقعی/وزیری sizes, model comparison.
- Phase 3 (later; don't build now, just don't block it): public signup, quotas, Stripe plans, admin.

## Tests / acceptance
- Fixtures: 5 real phone photos of book pages (including one spread, one skewed and one blurry), one scanned PDF, one text PDF.
- Unit tests for the Persian linter.
- Golden pipeline test on the fixtures. Render PDF page 1 to PNG and check RTL and embedded fonts. EPUB must pass epubcheck.
- Phase 1 is done when I can photograph 20 pages on my phone, upload them, and get a correctly ordered Persian PDF and EPUB that read naturally and print cleanly.
