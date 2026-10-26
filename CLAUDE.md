# Coach: Claude Code context

A private, single-user strength and nutrition coach for Erfan. Persian UI (RTL); code and comments
in English. The product spec is `COACH_SPEC.md` (build phases 0–5); `docs/AUDIT.md` records what was
removed from the previous product (Bookbridge, a book translator). Verified OpenAI facts are in
`docs/openai-api-notes.md`.

## Stack
- pnpm monorepo, TypeScript (strict), Node 22.
- `apps/web`: Next.js 16 App Router (Turbopack, `proxy.ts`), React 19, Tailwind 4, next-intl with the
  single locale `fa` (no URL prefix). Deploys on Vercel (project `booktranslate`, region `syd1`).
  Pages, actions and APIs talk to Supabase **as the signed-in user** (RLS). Exceptions, using the
  service role / `DATABASE_URL`: the worker route `app/api/worker/run` (+ `lib/workerRun.ts`), the
  migration runner `app/api/admin/migrate` and the health check (all CRON_SECRET-protected), and the
  sign-in action's rate limiter (`login_attempts`, written before anyone is signed in), and
  AI-usage logging inside `structuredCall()` (e.g. `/api/workout/comment`), which writes `ai_usage` through the core pool.
- Auth: sign-in runs server-side (`app/[locale]/login/actions.ts`); session cookies are httpOnly,
  Secure, SameSite=Lax, 30-day rolling (`lib/supabase/cookies.ts`). There is no browser Supabase
  client: storage uploads go through server routes (e.g. `app/api/photos`).
- `packages/core`: config, DB pool (`pg`), job queue + runner, OpenAI structured calls, usage/cost,
  migration runner. Web imports only the client-safe entry `@coach/core/shared` from client code.
- Supabase: Postgres, private Storage buckets, email + password auth for ONE owner account (sign-up
  off, no reset-by-email).
- OpenAI: official `openai` SDK, Responses API, Structured Outputs (`zodTextFormat`) for every
  machine-consumed call.

## Commands
```bash
pnpm install
pnpm dev          # Next dev server (apps/web)
pnpm typecheck    # tsc --noEmit across packages
pnpm test         # vitest unit tests
pnpm db:test      # throwaway Postgres 16: all migrations via the runner, then queue/RLS tests
pnpm migrate      # runner CLI against $DATABASE_URL (--apply, --confirm=<file>)
```

## Conventions
- **Deterministic engine, LLM for language** (spec §1): every number that matters is computed in
  code; the LLM explains, writes, picks within engine bounds, and chats.
- All tunable coaching constants live in ONE file, `packages/core/src/coach.config.ts`, each with a
  one-line rationale comment. Engine code in `packages/core/src/engine/` (pure, client-safe, tested).
- Model IDs, reasoning effort, prices and prompts are config (env, `config/prices.json`). Never
  hardcode a model ID in logic. Env: `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`.
- Every model call goes through `structuredCall()` (`packages/core/src/openai/structured.ts`): zod
  schema, validation, one corrective retry, then a friendly error; usage logged to `ai_usage` with a
  `feature`. Calls are blocked above `OPENAI_MONTHLY_BUDGET_USD` unless `essential: true`.
- Training (spec §6–§8): engine in `packages/core/src/engine/{library,program,progression,session,schedule,autoreg}.ts`;
  the exercise seed (Persian coaching content) in `packages/core/src/data/exercises/*.ts` is the source of
  truth, synced into `exercises` by the migration runner (edit the seed, never the table). Web glue in
  `apps/web/src/lib/{training,workoutActions,library}.ts`; gym mode (`/gym`, `components/gym`) is local-first:
  sets get client UUIDs, live in localStorage and sync through `/api/workout/sync`.
- The owner's calendar date on the server comes from the `tz` cookie (`lib/today.ts`); in the browser use
  `isoToday()`.
- Background work: add a handler in `packages/core/src/jobs/index.ts`; enqueue with `enqueue()`;
  long jobs call `checkpoint()` and throw `JobYield` (progress saved first).
- Relative imports inside `packages/core` are extensionless (Turbopack + transpiled workspace package).
- UI copy goes in `apps/web/messages/fa.json`. Use logical CSS (`ms-`/`me-`, `start`/`end`).
- Status shown in the UI is read from the DB. No fake progress, no fabricated "kg of muscle".
- Numbers: Latin digits with tabular figures by default (`.num`), Persian digits as a setting
  (`lib/format.ts`); numeric inputs accept Persian digits (`lib/digits.ts`). Dates are Jalali.
- Design tokens are CSS variables in `app/globals.css` (dark default, light via `data-theme`); one
  accent (saffron). Chart colours `--chart-*` are validated with the dataviz palette checker.

## Hard rules
- No keys in code. `.env.local` / platform secrets only. Keep `.env.example` current.
- Migrations: SQL files in `supabase/migrations/` named `YYYYMMDDHHMMSS_name.sql`, applied by the
  runner (never edited after being applied; the health check flags changed checksums).
  New table ⇒ `user_id` column + RLS enabled + owner policies in the same migration (exceptions:
  service-only tables with no user, such as `login_attempts`: RLS on, no policies; and the shared
  `exercises` library: authenticated may read, only the service role writes).
  Destructive changes go in their own migration marked `-- @destructive`; before running one on
  production, show the owner the table list with row counts and wait for an explicit "yes".
- Private buckets only, short-lived signed URLs (≤10 min). Photos: strip EXIF on upload.
- Never import `@coach/core` (server entry) or `lib/workerRun.ts` from client code.
- Files a package reads through computed paths must be listed in `outputFileTracingIncludes`
  (`apps/web/next.config.ts`), or the route works locally and crashes on Vercel. Turbopack's tracer
  crashes on path expressions that statically resolve to a directory: build such paths from a
  working directory it can't evaluate (see `migrationsDir()` in `packages/core/src/migrate.ts`).
- Safety (spec §6): pain ≥ 4 / red flags → hard-coded stop messages, never LLM-generated. No drugs,
  PEDs or supplements beyond creatine and protein powder.
