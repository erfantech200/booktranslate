-- Base tables for the coach: a generic background-job queue and the AI usage log.
-- Single owner, but every row carries user_id behind RLS like every other table.

-- ─── Background jobs ────────────────────────────────────────────────────────────────────────
-- Claimed by the worker route with SELECT … FOR UPDATE SKIP LOCKED (packages/core/src/queue.ts).
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Prevents duplicate live jobs for the same unit of work (e.g. 'exercise_image:<slug>').
  dedupe_key text,
  status text not null default 'queued' check (status in
    ('queued', 'running', 'done', 'failed', 'paused', 'cancelled')),
  priority integer not null default 0,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_until timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_claim_idx on public.jobs (priority desc, run_after) where status = 'queued';
create index jobs_lease_idx on public.jobs (locked_until) where status = 'running';
create index jobs_user_idx on public.jobs (user_id, created_at desc);
create unique index jobs_dedupe_live on public.jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running', 'paused');
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

alter table public.jobs enable row level security;
create policy owner_select on public.jobs for select to authenticated using (user_id = auth.uid());
-- The app may enqueue its own jobs, only as queued; state changes belong to the worker (service role).
create policy owner_insert on public.jobs for insert to authenticated
  with check (user_id = auth.uid() and status = 'queued' and attempts = 0);
revoke all on public.jobs from anon;
revoke update, delete on public.jobs from authenticated;

-- ─── AI usage (cost control) ───────────────────────────────────────────────────────────────
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feature text not null,
  model text not null,
  job_id uuid references public.jobs (id) on delete set null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  images integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true,
  request_id text,
  created_at timestamptz not null default now()
);
create index ai_usage_user_month_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
create policy owner_select on public.ai_usage for select to authenticated using (user_id = auth.uid());
-- Written only by server code with the service role.
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;
