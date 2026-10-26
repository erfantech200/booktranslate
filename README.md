# Coach

A private, single-user strength and nutrition coach (Persian UI). The product spec is
[`COACH_SPEC.md`](COACH_SPEC.md); the Phase 0 audit of the project it replaced (Bookbridge, a book
translator) is [`docs/AUDIT.md`](docs/AUDIT.md). Conventions and hard rules: [`CLAUDE.md`](CLAUDE.md).

## Status

Phase 0 is done: the translator is removed and the app is an empty, signed-in Persian shell
(login → home → sign out) with the infrastructure kept: Supabase auth/DB/storage, a background job
queue with a Vercel worker route, `structuredCall()` for OpenAI, AI usage logging with a monthly cap,
and a migration runner. Phases 1–5 (see the spec) build the product.

## Repo

```
apps/web       Next.js 16 (App Router) + Tailwind 4 + next-intl (Persian, RTL) → Vercel
packages/core  config, DB pool, job queue + runner, OpenAI structured calls, usage/cost, migrations
supabase/      SQL migrations (RLS on every table) + a local stub for tests
```

## Local development

Node 22 and pnpm 10.

```bash
pnpm install
pnpm test        # unit tests
pnpm db:test     # throwaway Postgres 16: every migration through the real runner, then queue + RLS tests
pnpm typecheck
pnpm dev         # needs .env.local (see .env.example)
```

## Deploying

Vercel project `booktranslate`, root directory `apps/web`, functions in `syd1` next to the Supabase
database. Pushing to `main` deploys production. Environment variables: see `.env.example`.

### Database migrations

The build container cannot reach the database, so production migrations run inside the app:

- `GET /api/admin/migrate?key=<CRON_SECRET>`: applied and pending migrations.
- `GET /api/admin/migrate?key=<CRON_SECRET>&apply=1`: applies pending migrations in order, and
  stops at a destructive one.
- `GET …&apply=1&confirm=<file.sql>`: also runs that destructive migration (only after the owner
  approves it).

`/api/health?key=<CRON_SECRET>` checks the whole setup and lists table row counts.

### Owner account

Exactly one account, created in Supabase → Authentication → Users (sign-up is off). There is no
password reset by email: reset it in the same dashboard.
