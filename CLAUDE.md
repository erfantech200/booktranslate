# Bookbridge: Claude Code context

AI book translation: phone photos / PDFs → structured blocks → Persian (first-class) or another
target → print-ready PDF + EPUB. The full product spec is `docs/SPEC.md`; verified OpenAI facts
are in `docs/openai-api-notes.md`. Single user (allowlist) today, but every row carries `user_id`
behind RLS so it can go multi-user later.

## Stack
- pnpm monorepo, TypeScript (strict) everywhere, Node 22.
- `apps/web`: Next.js 16 App Router + Tailwind 4 + next-intl (fa default/RTL, en). Deploys on Vercel.
  It talks to Supabase **as the signed-in user** (RLS) and never runs the pipeline.
- `apps/worker`: long-running Node process in Docker (Railway/Fly). Polls the `jobs` table and runs
  every pipeline stage. Image = Playwright Chromium + poppler-utils + libheif + fonts.
- `packages/core`: types (zod), DB access (`pg`), queue, OpenAI client, prompts, pipeline stages,
  Persian linter, renderers (HTML→PDF, EPUB). Used by both apps. Web imports only the client-safe
  entry `@bookbridge/core/shared`.
- Supabase: Postgres, private Storage buckets (`sources`, `pages`, `exports`), email + password auth
  (accounts created by the owner, public sign-up off, `app_allowlist` checked by RLS and the login page).
- OpenAI: official `openai` SDK, Responses API, Structured Outputs (`zodTextFormat`) for **every** call.

## Commands
```bash
pnpm install
pnpm dev:web            # Next dev server (apps/web)
pnpm dev:worker         # worker with tsx watch (needs DATABASE_URL etc.)
pnpm typecheck          # tsc --noEmit across all packages
pnpm test               # vitest: linter, chunking, ordering, stitch, queue, renderers, golden pipeline
pnpm test:epubcheck     # downloads epubcheck (Maven Central) once, then validates the fixture EPUB
pnpm db:test            # spins a throwaway local Postgres 16, applies migrations, runs queue tests
pnpm fixtures           # regenerates synthetic fixture images/PDFs (fixtures/generated/)
```

## Layout
```
apps/web/src/app/[locale]/…   screens (library, book, glossary, usage); app/auth/callback; app/api/*
apps/worker/src/index.ts      poll loop → core/pipeline handlers
packages/core/prompts/        versioned prompt files (ocr.v1.md, translate.system.v1.md, style/fa.v1.md …)
packages/core/config/         prices.json (USD / 1M tokens), page sizes
packages/core/assets/fonts/   vendored OFL fonts (Noto Naskh Arabic, Vazirmatn, Noto Serif)
packages/core/src/pipeline/   ingest → extract → assemble (order+stitch+quality) → glossary → translate → render
packages/core/src/lint/       deterministic per-language post-processing (fa.ts)
packages/core/src/render/     html.ts (shared book HTML), pdf.ts (Playwright), epub.ts (JSZip)
supabase/migrations/          SQL, RLS on every table
```

## Pipeline & job model
- `jobs(type, payload, status, run_after, attempts, max_attempts, locked_until)`. The worker claims
  jobs with `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction (works through the transaction
  pooler, so no LISTEN/NOTIFY). Exponential backoff on failure. A lease (`locked_until`) + heartbeat
  lets a crashed worker's job be re-claimed.
- Job types: `ingest_batch` → `extract_page` (fan-out) → `assemble_batch` → `glossary_batch` →
  `translate_batch` → `render_export`. Every stage is **idempotent**: re-running it skips work whose
  content hash (`input sha256 + model + prompt version`) hasn't changed.
- Budget caps (per book, monthly) are checked before every model call; a hit puts the job in
  `paused` instead of failing it.

## Conventions
- Model IDs, reasoning effort, prices and prompts are **config** (env, `config/prices.json`,
  `prompts/*.md`). Never hardcode a model ID in logic.
- Every model call goes through `structuredCall()` (`packages/core/src/openai/structured.ts`): it
  sets the zod schema, validates, retries once on invalid output and then flags, and logs usage.
  It is the only place that talks to OpenAI.
- Blocks are the unit of truth: `blocks.source_text`, `translated_text`, `user_override`, and page
  provenance (`page_ids[]`). Re-runs never touch `user_override`.
- Persian lint applies only safe auto-fixes (ی/ک, ZWNJ, punctuation, digits). Everything else is a
  flag on the block.
- Relative imports inside `packages/core` are extensionless (`'./types'`, not `'./types.js'`):
  Turbopack doesn't map `.js`→`.ts` for the transpiled workspace package. tsx/Vitest/Next all
  resolve extensionless imports (`moduleResolution: Bundler`).
- UI copy goes in `apps/web/messages/{fa,en}.json`. Use logical CSS (`ms-`/`me-`, `start`/`end`),
  never `left`/`right`.
- Status shown in the UI is read from the DB (pages.status, jobs, usage_log). No fake progress.

## Hard rules
- No keys in code. `.env.local` / platform secrets only. Keep `.env.example` current.
- All files live in private buckets behind short-lived signed URLs (≤10 min).
- Every model call: Structured Outputs + zod. On invalid output: retry once, then flag.
- New table ⇒ `user_id` column + RLS enabled + owner policies in the same migration.
- The worker uses the service role. The web app never does, except in the allowlist check
  (no service key in client bundles).
- Don't bump `playwright` without matching the Docker base image tag (`mcr.microsoft.com/playwright:vX-noble`).

## Phase status
Phase 1 (MVP) is what is built. Phase 2 items (reader, camera capture, quality-gate blocking, Batch
"Cheap" mode, bilingual, DOCX, رقعی/وزیری, model comparison) have schema/config hooks but no UI.
Phase 3 (public signup, quotas, Stripe, admin) is not built. Nothing should block it: no
single-user assumptions in SQL.
