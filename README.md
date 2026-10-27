# Coach

A private, single-user strength and nutrition coach (Persian UI). The product spec is
[`COACH_SPEC.md`](COACH_SPEC.md); the Phase 0 audit of the project it replaced (Bookbridge, a book
translator) is [`docs/AUDIT.md`](docs/AUDIT.md). Conventions and hard rules: [`CLAUDE.md`](CLAUDE.md).

## Status

- **Phase 0:** the translator is removed; the infrastructure is kept (Supabase auth/DB/storage, a background job queue with a Vercel
  worker route, `structuredCall()` for OpenAI, AI usage logging with a monthly cap, and a migration runner).
- **Phase 1:**
  - hardened single-owner sign-in;
  - a Persian app shell (dark/light, tabs, PWA);
  - onboarding and Settings;
  - baseline progress photos;
  - daily weigh-ins with a weight chart (7-day average, plan line, trend projection).
- **Phase 2:**
  - an exercise library of 78 exercises with Persian coaching content (`packages/core/src/data/exercises`);
  - a deterministic program generator: 3–6 day splits, 5-week blocks with a deload, volume and session-length fitting;
  - gym mode (`/gym`): prefilled set logging that works offline, warm-ups, a rest timer, swaps, pain reports and PRs;
  - double progression, stall and early-deload detection, missed-session handling, and a finish summary with a short coach comment.

- **Phase 3:**
  - a food database of 200 foods (USDA reference values, Persian staples) in `packages/core/src/data/foods.ts`;
  - deterministic targets (Mifflin-St Jeor, activity factor, +300 kcal, protein 1.8 g/kg, fat, fiber, water);
  - a weekly meal plan written by the LLM as a background job, with portions scaled by code to ±5 % kcal and ±10 % protein, variety rules and a grocery list;
  - logging by "ate as planned", free text or photo (the model maps foods and grams, code computes macros, you confirm), daily rings and a one-tap meal swap.

- **Phase 4:**
  - Progress tab with four sections: Overview, Strength, Body & photos, and Journey;
  - a "gain quality" indicator: waist change per kg gained and the strength trend over 4 weeks. It is labelled as a proxy, never as kg of muscle;
  - adherence over the last 4 weeks (workouts, protein days, calorie days) and logging streaks;
  - e1RM charts for the main lifts, records, weekly tonnage, and weekly sets per muscle against the block's plan;
  - measurements every 2 weeks; a photo camera that overlays the previous photo as a ghost; a photo compare view (side by side or slider);
  - a timeline of the year.

Phase 5 (see the spec) adds the AI coach.

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
pnpm seed:dev -- --reset   # LOCAL database only: 8 weeks of realistic fake history for the only user (or --user=<id>)
```

`seed:dev` refuses any `DATABASE_URL` that isn't localhost. It generates the history with the real engine
(`packages/core/src/dev/fakeData.ts`): weigh-ins, measurements, two training blocks with progression, readiness and food logs.
It does not create photos.

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

After applying, the reference seeds (exercises, foods) are synced into their tables: only changed rows are written.
`pnpm migrate --apply` does the same locally.

`/api/health?key=<CRON_SECRET>` checks the whole setup and lists table row counts.

### Owner account

Exactly one account, created in Supabase → Authentication → Users (sign-up is off). There is no
password reset by email: reset it in the same dashboard.
