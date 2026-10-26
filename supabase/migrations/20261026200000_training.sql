-- Phase 2: exercise library, mesocycles and program, workout sessions and set logs, pain and
-- readiness (spec §6–§8, §14).

-- ─── Exercise library (shared reference data) ───────────────────────────────────────────────
-- No user_id: one library for the app. Documented exception to the owner-policy rule: signed-in
-- users may read it; only the service role writes (the seed in packages/core/src/data/exercises
-- is synced in by the migration runner; Phase 5 adds AI-written entries with source = 'ai').
create table public.exercises (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en text not null,
  name_fa text not null,
  movement_pattern text not null,
  primary_muscles text[] not null,
  secondary_muscles text[] not null default '{}',
  equipment jsonb not null,                                -- alternative sets: [["barbell","rack"],["dumbbells"]]
  difficulty integer not null check (difficulty between 1 and 3),
  unilateral boolean not null default false,
  compound boolean not null default false,
  timed boolean not null default false,                    -- rep range is seconds (holds)
  load_type text not null check (load_type in ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'band')),
  region text not null check (region in ('upper', 'lower', 'core')),
  rank integer not null,
  rep_min integer not null,
  rep_max integer not null,
  default_rest_sec integer not null,
  setup_steps text[] not null,
  execution_steps text[] not null,
  form_cues text[] not null,
  common_mistakes jsonb not null,                          -- [{ "mistake": "…", "fix": "…" }]
  breathing text not null,
  tempo text not null,
  safety_notes text[] not null,
  contraindications text[] not null default '{}',
  cautions text[] not null default '{}',
  regressions text[] not null default '{}',
  progressions text[] not null default '{}',
  substitutes text[] not null default '{}',
  image_url text,
  image_status text not null default 'pending' check (image_status in ('pending', 'ok', 'flagged')),
  video_search_url text not null,
  source text not null default 'seed' check (source in ('seed', 'ai')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercises_pattern_idx on public.exercises (movement_pattern, rank);
create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();
alter table public.exercises enable row level security;
create policy exercises_read on public.exercises for select to authenticated using (true);
revoke all on public.exercises from anon;
revoke insert, update, delete, truncate on public.exercises from authenticated;

-- ─── Per-exercise preferences (exclusions after pain or by hand) ────────────────────────────
create table public.exercise_prefs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null references public.exercises (slug) on update cascade on delete cascade,
  excluded boolean not null default false,
  excluded_reason text check (excluded_reason in ('pain', 'manual')),
  excluded_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, slug)
);

-- ─── Mesocycles (training blocks) ───────────────────────────────────────────────────────────
create table public.mesocycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seq integer not null check (seq >= 1),
  block_no integer not null check (block_no >= 1),         -- training block number (a rebuild keeps it)
  start_date date not null,
  weeks integer not null check (weeks between 3 and 8),
  deload_week integer not null check (deload_week between 1 and 8),
  status text not null default 'active' check (status in ('active', 'done')),
  ended_reason text check (ended_reason in ('completed', 'rebuilt')),
  early_deload_reason text check (early_deload_reason in ('regression', 'readiness')),
  days_per_week integer not null,
  session_minutes integer not null,
  training_days integer[] not null,                        -- weekdays, 0 = Saturday
  missing_patterns text[] not null default '{}',
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (user_id, seq)
);
create unique index mesocycles_one_active on public.mesocycles (user_id) where status = 'active';

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mesocycle_id uuid not null references public.mesocycles (id) on delete cascade,
  idx integer not null,
  kind text not null,
  unique (mesocycle_id, idx)
);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  program_day_id uuid not null references public.program_days (id) on delete cascade,
  idx integer not null,
  slug text not null references public.exercises (slug) on update cascade,
  role text not null check (role in ('main', 'accessory', 'isolation')),
  sets_by_week integer[] not null,                         -- hard weeks; the deload week is derived
  rep_min integer not null,
  rep_max integer not null,
  rest_sec integer not null,
  replaced_from text,                                      -- swapped for the rest of the block
  unique (program_day_id, idx)
);

-- ─── Workout sessions and set logs ──────────────────────────────────────────────────────────
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mesocycle_id uuid not null references public.mesocycles (id) on delete cascade,
  week integer not null,
  day_idx integer not null,
  merged_day_idx integer,                                  -- a missed day merged into this one
  date date not null,                                      -- the owner's local date
  status text not null default 'active' check (status in ('active', 'done', 'skipped')),
  deload boolean not null default false,
  low_readiness boolean not null default false,
  plan jsonb,                                              -- prescription snapshot (engine SessionPlan)
  summary jsonb,
  coach_comment text,
  comment_status text not null default 'none' check (comment_status in ('none', 'pending', 'ok', 'failed')),
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_sessions_user_idx on public.workout_sessions (user_id, date desc);
create index workout_sessions_meso_idx on public.workout_sessions (mesocycle_id, week);
create unique index workout_sessions_one_active on public.workout_sessions (user_id) where status = 'active';
create trigger workout_sessions_touch before update on public.workout_sessions
  for each row execute function public.touch_updated_at();

create table public.set_logs (
  id uuid primary key,                                     -- generated on the phone: retries are idempotent
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  slug text not null references public.exercises (slug) on update cascade,
  ex_idx integer not null,
  set_idx integer not null,
  is_warmup boolean not null default false,
  weight_kg numeric(6, 2) not null default 0 check (weight_kg between 0 and 1000),
  reps integer not null check (reps between 0 and 600),     -- seconds for timed holds
  rir numeric(3, 1) check (rir between 0 and 10),
  pain integer check (pain between 0 and 10),
  rep_min integer,                                         -- what was prescribed (progression reads these)
  rep_max integer,
  target_rir numeric(3, 1),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index set_logs_session_idx on public.set_logs (session_id, ex_idx, set_idx);
create index set_logs_history_idx on public.set_logs (user_id, slug, logged_at);

-- ─── Pain reports and daily readiness ───────────────────────────────────────────────────────
create table public.pain_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  slug text references public.exercises (slug) on update cascade,
  session_id uuid references public.workout_sessions (id) on delete set null,
  area text not null check (area in ('shoulder', 'elbow', 'wrist', 'lower_back', 'hip', 'knee', 'ankle', 'neck', 'upper_back', 'other')),
  level integer not null check (level between 0 and 10),
  sharp boolean not null default false,
  red_flag text check (red_flag in ('chest_pain', 'dizziness', 'numbness', 'sharp_joint')),
  note text,
  created_at timestamptz not null default now()
);
create index pain_reports_user_idx on public.pain_reports (user_id, date desc);

create table public.readiness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  sleep_hours numeric(3, 1) check (sleep_hours between 0 and 16),
  energy integer check (energy between 1 and 5),
  soreness integer check (soreness between 1 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ─── RLS: the owner reads and writes only their own rows ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['exercise_prefs', 'mesocycles', 'program_days', 'program_exercises', 'workout_sessions', 'set_logs', 'pain_reports', 'readiness'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
