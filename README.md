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

Every stage is a row in `jobs`, claimed with `SELECT … FOR UPDATE SKIP LOCKED` by the worker. The worker runs inside the Vercel app (`/api/worker/run`). Each run works for up to ~4½ minutes; long stages save their progress and continue in the next run. A run starts when you upload, export, edit the glossary or resume, and the book page also starts one while you have it open. A daily Vercel cron is a safety net. Stages are idempotent and keyed by content hashes, so re-runs never re-OCR or re-translate unchanged content. Every model call is logged with its real token usage and cost. Book and monthly budget caps pause jobs instead of failing them.

## Repo

```
apps/web       Next.js 16 (App Router) + Tailwind 4 + next-intl (fa RTL default, en) + the pipeline worker route → Vercel
apps/worker    optional always-on worker (Docker) if you ever outgrow Vercel's time limits
packages/core  types, DB, queue, OpenAI client, prompts, pipeline, Persian linter, renderers
supabase/      SQL migrations (RLS on every table, private buckets)
fixtures/      synthetic test pages; put real photos in fixtures/real/
```

## Local development

Requires Node 22 and pnpm 10. The tests also use poppler-utils (to inspect rendered PDFs) and Java 11+ (epubcheck); the app itself doesn't.

```bash
pnpm install
pnpm test             # unit tests: linter, ordering, stitching, chunking, structured calls, PDF/EPUB (+ epubcheck)
pnpm db:test          # throwaway Postgres 16 + migrations: queue, RLS, golden pipeline end to end
pnpm typecheck
```

## Setup (one-time)

1. **Supabase project**
   - Apply the migrations: `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor, in order).
   - Authentication → Sign In / Providers: keep **Email** enabled and turn **off** "Allow new users to sign up".
   - Authentication → Users → **Add user → Create new user** for each team member (email + password, tick
     "Auto Confirm User").
   - Allow those emails (RLS and the login page both check this list):
     ```sql
     insert into public.app_allowlist (email) values
       (lower('you@example.com')), (lower('teammate@example.com'));
     ```
2. **Vercel** (website + worker): import the repo and set **Root Directory** to `apps/web`; keep
   "Include files outside the root directory" on. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; used by the worker route)
   - `DATABASE_URL`: Supabase transaction pooler, port 6543
   - `OPENAI_API_KEY`
   - `CRON_SECRET`: any long random string; it protects `/api/worker/run`

   Fluid compute must be on (default for new projects) so a run can last up to 300 s. Vercel's free
   Hobby plan is for personal, non-commercial use; a team may need Pro.
3. *(Optional)* An always-on Docker worker (`apps/worker/Dockerfile`, configs for Railway/Fly) can
   run alongside or instead of the Vercel worker. Both share the same queue safely.

## Status

Phase 1 is built: email + password sign-in for allowlisted accounts, books, uploads of photos/PDF/TXT, OCR, stitching, an editable auto-glossary, Fast translation, Persian lint, PDF (A4/A5) and EPUB, plus per-page status and cost.

Some of it has not run against live services yet, because this build environment has no OpenAI key and no Supabase project:
- The real OpenAI calls are untested. In tests a deterministic fake stands in for the model.
- Sign-in against a real Supabase project is untested.
- Not yet deployed to Vercel. The worker route was tested locally on a production build (ingest, PDF/EPUB export with the serverless Chromium) against a local Postgres.

Phase 2 (reader, camera capture, blocking quality gate, Batch "Cheap" mode, bilingual, DOCX, رقعی/وزیری, model comparison) has schema and config hooks only.
