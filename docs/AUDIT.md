# Phase 0 audit: Bookbridge → personal coach

Date: 2026-10-26. Branch: `rebuild/coach`. Spec: `COACH_SPEC.md`.

## 1. What is there today

| Area | Today | Keep for the coach? |
|---|---|---|
| Repo | pnpm 10 monorepo, Node 22, TypeScript strict: `apps/web`, `apps/worker`, `packages/core` | Keep `apps/web` + `packages/core`; drop `apps/worker` |
| Framework | Next.js 16.4.3 (App Router, Turbopack, `proxy.ts`), React 19.3, Tailwind 4.3, next-intl 4.14 (fa + en) | Keep; Persian only |
| Database | Supabase Postgres 16. Access: `@supabase/ssr` as the signed-in user (RLS) in pages/actions; raw `pg` (service role, `DATABASE_URL`, transaction pooler :6543) in the worker | Keep both patterns |
| ORM | None. SQL migrations in `supabase/migrations/*.sql` + zod types in `packages/core/src/types.ts` | Keep (no ORM) |
| Migration tool | None automated. Migrations were pasted into the Supabase SQL editor; a local throwaway Postgres runs them in tests (`pnpm db:test`) | See question 3 |
| Auth | Supabase Auth, email + password. Public sign-up off. `app_allowlist` checked by RLS (`is_allowed()`) and the login page. Forgot-password email flow + `/auth/callback` | Keep Supabase Auth; remove reset-by-email and allowlist (single owner) |
| Storage | Supabase Storage, private buckets `sources`, `pages`, `exports`, signed URLs ≤ 10 min | Keep the pattern; new buckets for progress and meal photos |
| Hosting | Vercel project `booktranslate` (team erfans-projects), production `booktranslate-nine.vercel.app`, functions in `syd1` (database is in Sydney), Fluid compute, daily cron `/api/worker/run` 03:17 UTC | Keep |
| Background jobs | `jobs` table claimed with `FOR UPDATE SKIP LOCKED`, lease + heartbeat, yield/resume inside a 300 s Vercel function (`/api/worker/run`, CRON_SECRET) | Keep the machinery (generic); use it for image batches, meal plans and the weekly check-in |
| OpenAI | `openai` 7.43.0, Responses API, Structured Outputs via `structuredCall()` (zod, retry once, usage logging) | Keep `structuredCall()` |
| Tests | Vitest: 46 unit + 10 DB tests (Postgres 16) | Keep the harness; replace the tests |

### Environment variables (names only)

Set on Vercel, **Production only** (none for Preview): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`, `CRON_SECRET`.
`next.config.ts` maps the first two to `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Optional ones in `.env.example`, unset on Vercel (code defaults apply): `OCR_*`, `STRUCTURE_*`,
`GLOSSARY_*`, `TRANSLATION_*`, `PREMIUM_TRANSLATION_*`, `COMPARE_MODELS`, `PROMPT_CACHE_RETENTION`,
`OPENAI_MAX_RETRIES`, `STORAGE_DRIVER`, `WORKER_*`, `JOB_LEASE_SECONDS`, `APP_URL`.

### OpenAI models in use

| Use | Model |
|---|---|
| OCR / page structure (vision) | `gpt-6-luna` |
| Glossary, translation | `gpt-6.1-sol` |
| Premium translation | `gpt-6-astra` |
| Images | none used. The SDK offers `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini` |

All three text models answer on the production key (health check, 2026-10-26). Prices in
`packages/core/config/prices.json` are unverified third-party figures.

Proposed defaults for the coach:
- `OPENAI_TEXT_MODEL=gpt-6.1-sol`: coaching language, meal plans, chat.
- `OPENAI_VISION_MODEL=gpt-6-luna`: meal photos. It is cheap, and it read book pages well.
- `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare`: the newest image model in the SDK, not yet tried on this key.

### Production data (health check, 2026-10-26 13:53 UTC)

| Object | Kind | Rows / files |
|---|---|---|
| `app_allowlist` | table | 1 |
| `books` | table | 1 |
| `batches` | table | 1 |
| `source_files` | table | 1 |
| `pages` | table | 3 |
| `blocks` | table | 13 |
| `glossary_terms` | table | 2 |
| `exports` | table | 4 |
| `jobs` | table | 11 (8 done, 3 failed) |
| `usage_log` | table | 5 |
| `user_settings` | table | 0 |
| `book_costs`, `book_progress`, `monthly_costs` | views | – |
| `is_allowed()`, `resume_paused_jobs()`, `touch_updated_at()` | functions | – |
| bucket `sources` / `pages` / `exports` | storage | 1 / 6 / 1 files, 0.5 MB total |
| `auth.users` | Supabase Auth | 1 account |

That is one test book of about 13 paragraphs. Nothing here carries over to the coach.

## 2. Removal plan

### Delete

**Web app (`apps/web`)**
- Screens: library (`(app)/page.tsx`), `books/[id]/**` (book, glossary, review, export preview), `usage/`, `reset-password/`.
- API: `api/books/**`, `api/exports/**`, `auth/callback/` (only used by the reset email).
- Components: `LiveBook`, `Uploader`, `BookCover`, `PdfPreview`, `EpubPreview`, `BackLink`. The Bookbridge brand goes too: `Logo`, `AuthFrame`, `RailNav`, `AppShell`, `app/icon.svg`, `apple-icon.png`, `public/icons/*`. Phase 1 brings the new shell and icon.
- `lib/data.ts`, `scripts/copy-pdf-worker.mjs`, the forgot-password part of `PasswordSignIn`, all of `messages/en.json` and the translator keys in `fa.json`.
- Fonts Estedad, Noto Kufi, Reem Kufi and Noto Naskh. The spec asks for Vazirmatn.

**Core (`packages/core`)**
- `pipeline/{ingest,extract,assemble,glossary,translate,export,image,pdf}.ts`, `lint/`, `render/`.
- Translator prompts (`prompts/*.md`; keep the loader `prompts.ts`), `config/page-sizes.json`, `assets/fonts/`, `assets.ts`.
- `scripts/{epubcheck,make-fixtures,vendor-fonts}.ts`, `fixtures/`, and the tests for removed modules (`assemble`, `lint.fa`, `render`, the pipeline DB test).

**Everything else**
- `apps/worker/` (Docker, Fly, Railway).
- `docs/SPEC.md` (replaced by `COACH_SPEC.md`), `docs/brand/`.
- README and CLAUDE.md, rewritten for the coach.

### Keep and adapt
- `proxy.ts` (auth gate), `lib/supabase/*`, the `login` page, `[locale]/layout.tsx`, `api/health` (with new checks), `vercel.json` (syd1, cron).
- The CSP and security headers in `next.config.ts`. The worker tracing rules for Chromium/pdf.js go.
- `api/worker/run` + `lib/workerRun.ts` + `lib/kick.ts`, with the job handlers replaced.
- Core: `openai/structured.ts`, `config.ts` (rewritten for the coach env vars), `cost.ts`, `usage.ts` (→ `ai_usage`), `db/pool.ts`, `queue.ts`, `runner.ts`, `pipeline/context.ts` (→ `jobs/context.ts`), `hash.ts`, `storage.ts`, `prices.json` (+ image prices).
- The queue/RLS DB tests, adapted to the new schema.

### Dependencies that become unused
- `apps/web`: `@napi-rs/canvas`, `@sparticuz/chromium`, `playwright-core`, `pdfjs-dist`, `heic-convert`, `jszip`.
- `packages/core`: the same six, plus `exifr`, `p-limit` (if no longer used) and dev deps `@fontsource/noto-naskh-arabic`, `@fontsource/noto-serif`, `@fontsource/vazirmatn` (Vazirmatn will be self-hosted from a woff2 in the web app).
- Stay: `sharp` (resize + strip EXIF from progress and meal photos), `openai`, `zod`, `pg`, `@supabase/*`, `next-intl`.

This also shrinks the worker function from ~147 MB to a few MB.

### Database: a separate destructive migration
1. `supabase/migrations/20261026000000_drop_translator.sql` drops:
   - the views `book_costs`, `book_progress`, `monthly_costs`;
   - the tables `blocks`, `glossary_terms`, `exports`, `pages`, `source_files`, `batches`, `books`, `jobs`, `usage_log`, `user_settings`, `app_allowlist`;
   - the functions `resume_paused_jobs`, `is_allowed`;
   - the storage policies of the three buckets.

   It keeps `touch_updated_at()`, which is generic. `jobs` is recreated without book columns in Phase 1, and `usage_log` becomes `ai_usage`.
2. Storage files: Supabase refuses direct SQL deletes on `storage.objects`. The 8 files and the three buckets are removed through the Storage API (service key) as part of the same step.
3. A matching rollback file is not useful here: the data is being thrown away on purpose. I will say so in the migration header.
4. **Gate:** before it runs on production, I re-run the health check, show you the table list with row counts, and wait for your explicit "yes".

After Phase 0 the app builds and deploys as an empty, signed-in Persian shell: login → a blank home page → sign out.

## 3. Open questions

1. **Losing the translator.** Merging this removes Bookbridge for good, including access for the five teammates you mentioned. Only one account exists today, so nobody else loses data. If the team still needs the translator, it can live on as its own Vercel project with its own database before I delete it here.
2. **Where each phase deploys.** The env vars exist only for Production, so a preview deployment of `rebuild/coach` would show "Setup needed".
   - *Recommended:* I merge each finished phase into `main`, so you test on the normal URL on your phone.
   - *Alternative:* you tick "Preview" on the six variables in Vercel → Settings → Environment Variables. Branch previews then work, behind Vercel's own login. They would share the same database.
3. **Applying migrations.** This container cannot reach the database.
   - *Recommended:* a migration runner inside the app, protected by `CRON_SECRET`, that applies `supabase/migrations/*.sql` in order and records them in a `schema_migrations` table. Destructive migrations would need an extra confirm parameter, and I would only send it after your "yes".
   - *Alternative:* you paste each migration into the Supabase SQL editor.
4. **Forgotten password.** With no reset-by-email, you would reset the password in the Supabase dashboard (Authentication → Users). OK?
