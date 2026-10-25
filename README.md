# Bookbridge

Bookbridge turns phone photos of paper book pages (or PDFs) into a clean, print-ready translation. Persian (fa) is the first-class target. You photograph ~20 pages, upload them, and get back an ordered Persian PDF (A4/A5) and an EPUB. Then you add the next 20 pages to the same book: order, glossary and chapter structure carry over.

- Spec: [`docs/SPEC.md`](docs/SPEC.md)
- Verified OpenAI model IDs and parameters: [`docs/openai-api-notes.md`](docs/openai-api-notes.md)
- Conventions and hard rules: [`CLAUDE.md`](CLAUDE.md)

## How it works

```
upload (browser → private Storage)
  → ingest_batch     EXIF-rotate, HEIC→JPEG, resize, contrast; PDF pages: text layer or rasterize
  → extract_page     OCR (gpt-6-luna, Structured Outputs) or a cheap structuring pass for text layers;
                     a two-page spread is split and each half OCR'd
  → assemble_batch   order by printed page no. → EXIF time → filename; stitch paragraphs across
                     pages (and batches); quality warnings: gaps, duplicates, blur/glare/cut-off
  → glossary_batch   book brief + names/terms (editable, lockable)
  → translate_batch  whole-block chunks, cache-friendly prompt prefix, Persian lint + 1 auto-retry
  → render_export    HTML → PDF (Playwright Chromium) and EPUB 3, cached by content hash
```

Every stage is a row in `jobs`, claimed with `SELECT … FOR UPDATE SKIP LOCKED` by the worker. Stages are idempotent and keyed by content hashes, so re-runs never re-OCR or re-translate unchanged content. Every model call is logged with its real token usage and cost. Book and monthly budget caps pause jobs instead of failing them.

## Repo

```
apps/web       Next.js 16 (App Router) + Tailwind 4 + next-intl (fa RTL default, en) → Vercel
apps/worker    Node worker (Docker: Playwright Chromium, poppler-utils, libheif, fonts) → Railway / Fly
packages/core  types, DB, queue, OpenAI client, prompts, pipeline, Persian linter, renderers
supabase/      SQL migrations (RLS on every table, private buckets)
fixtures/      synthetic test pages; put real photos in fixtures/real/
```

## Local development

Requires Node 22, pnpm 10, and poppler-utils. Java 11+ is needed only for epubcheck.

```bash
pnpm install
pnpm test             # unit tests: linter, ordering, stitching, chunking, structured calls, PDF/EPUB (+ epubcheck)
pnpm db:test          # throwaway Postgres 16 + migrations: queue, RLS, golden pipeline end to end
pnpm typecheck
```

## Setup (one-time)

1. **Supabase project**
   - Apply the migrations: `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor, in order).
   - Add your email to the allowlist (RLS and the OAuth callback both check it):
     ```sql
     insert into public.app_allowlist (email) values (lower('you@example.com'));
     ```
   - Auth → Providers → Google: enable it and add your Google OAuth client ID and secret.
   - Auth → URL configuration: add `https://YOUR-APP.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback`) to the redirect URLs.
2. **Web (Vercel)**: set the root directory to `apps/web`. Env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Worker (Railway or Fly.io)**: build from the repo root with `apps/worker/Dockerfile` (configs: `apps/worker/railway.json`, `apps/worker/fly.toml`). Secrets: `DATABASE_URL` (transaction pooler, port 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, plus any model overrides from [`.env.example`](.env.example).

## Status

Phase 1 is built: allowlist auth, books, uploads of photos/PDF/TXT, OCR, stitching, an editable auto-glossary, Fast translation, Persian lint, PDF (A4/A5) and EPUB, plus per-page status and cost.

Some of it has not run against live services yet, because this build environment has no OpenAI key and no Supabase project:
- The real OpenAI calls are untested. In tests a deterministic fake stands in for the model.
- Google sign-in is untested.
- The Docker image was not built here.

Phase 2 (reader, camera capture, blocking quality gate, Batch "Cheap" mode, bilingual, DOCX, رقعی/وزیری, model comparison) has schema and config hooks only.
