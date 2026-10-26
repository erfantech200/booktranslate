-- Phase 1: owner profile (onboarding), daily body metrics, progress photos, login rate limiting.

-- ─── Profile (one row per user, filled by onboarding, editable in Settings) ────────────────
create table public.profile (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  onboarded_at timestamptz,
  -- Body
  sex text check (sex in ('male', 'female')),
  birth_year integer check (birth_year between 1920 and 2015),
  height_cm numeric(5, 1) check (height_cm between 120 and 230),
  -- Training
  experience text check (experience in ('none', 'lt6m', '6to24m', 'gt2y')),
  train_location text check (train_location in ('gym', 'home')),
  equipment text[] not null default '{}',
  dumbbell_min_kg numeric(5, 1),
  dumbbell_max_kg numeric(5, 1),
  days_per_week integer check (days_per_week between 3 and 6),
  session_minutes integer check (session_minutes in (45, 60, 75, 90)),
  preferred_days integer[] not null default '{}',          -- 0 = Saturday … 6 = Friday
  -- Health
  injury_areas text[] not null default '{}',
  injury_notes text,
  medical_notes text,
  cardio_risk boolean not null default false,              -- cardiovascular condition or high BP reported
  daily_activity text check (daily_activity in ('sedentary', 'light', 'active')),
  -- Food
  cuisines text[] not null default '{}',
  disliked_foods text,
  allergies text,
  dietary_rules text,
  cooking_minutes integer check (cooking_minutes between 0 and 240),
  budget text check (budget in ('low', 'medium', 'high')),
  meals_per_day integer check (meals_per_day between 3 and 6),
  appetite text check (appetite in ('low', 'normal', 'high')),
  -- Goal (null rate = engine default)
  start_date date,
  start_weight_kg numeric(5, 2),
  target_gain_pct_week numeric(4, 2) check (target_gain_pct_week between 0.05 and 1),
  target_weight_12m_kg numeric(5, 1),
  -- Display
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  digits text not null default 'latin' check (digits in ('latin', 'persian')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profile_touch before update on public.profile
  for each row execute function public.touch_updated_at();

-- ─── Body metrics (one row per day; weight daily, measurements every ~2 weeks) ─────────────
create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  weight_kg numeric(5, 2) check (weight_kg between 30 and 250),
  waist_cm numeric(5, 1) check (waist_cm between 40 and 200),
  chest_cm numeric(5, 1) check (chest_cm between 50 and 200),
  arm_cm numeric(5, 1) check (arm_cm between 15 and 70),
  thigh_cm numeric(5, 1) check (thigh_cm between 30 and 110),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);
create index body_metrics_user_date_idx on public.body_metrics (user_id, date desc);
create trigger body_metrics_touch before update on public.body_metrics
  for each row execute function public.touch_updated_at();

-- ─── Progress photos (files in the private bucket below) ───────────────────────────────────
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  taken_on date not null,
  angle text not null check (angle in ('front', 'side', 'back')),
  storage_path text not null unique,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index progress_photos_user_idx on public.progress_photos (user_id, taken_on desc);

-- ─── RLS: the owner reads and writes only their own rows ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profile', 'body_metrics', 'progress_photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ─── Login rate limiting (spec §3: 5 attempts / 15 min / IP) ───────────────────────────────
-- Written before anyone is signed in, so it has no user_id: service role only (RLS on, no
-- policies). Stores a salted hash of the IP, never the IP itself.
create table public.login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_ip_idx on public.login_attempts (ip_hash, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

-- ─── Storage: progress photos (private; paths start with '<user_id>/') ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('progress-photos', 'progress-photos', false, 10485760)
on conflict (id) do nothing;

create policy progress_photos_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy progress_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy progress_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
