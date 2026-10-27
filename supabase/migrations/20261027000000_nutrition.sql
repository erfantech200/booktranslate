-- Phase 3: food database, nutrition targets, weekly meal plans and food logging (spec §9, §14).

-- ─── Foods (macros per 100 g as eaten) ──────────────────────────────────────────────────────
-- Seed rows have no user_id (shared reference data synced from packages/core/src/data/foods.ts by
-- the migration runner, written by the service role). Foods the LLM estimates for the owner carry
-- their user_id, source 'ai' and estimated = true; only the owner sees and edits those.
create table public.foods (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  user_id uuid references auth.users (id) on delete cascade,
  name_fa text not null,
  name_en text not null default '',
  category text not null check (category in
    ('grains', 'legumes', 'meat_fish', 'dairy_eggs', 'nuts_seeds', 'fats_oils', 'vegetables', 'fruits', 'pantry', 'drinks', 'supplements')),
  kcal numeric(6, 1) not null check (kcal between 0 and 950),
  protein_g numeric(5, 1) not null check (protein_g between 0 and 100),
  carbs_g numeric(5, 1) not null check (carbs_g between 0 and 100),
  fat_g numeric(5, 1) not null check (fat_g between 0 and 100),
  fiber_g numeric(5, 1) not null default 0 check (fiber_g between 0 and 100),
  unit_fa text,
  unit_g numeric(6, 1) check (unit_g > 0),
  whole boolean not null default false,
  veg_fruit boolean not null default false,
  protein_kind text,
  carb_kind text,
  allergens text[] not null default '{}',
  raw_per_cooked numeric(4, 2),
  estimated boolean not null default false,
  source text not null default 'seed' check (source in ('seed', 'ai', 'manual')),
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'seed') = (user_id is null))
);
create index foods_user_idx on public.foods (user_id) where user_id is not null;
create trigger foods_touch before update on public.foods
  for each row execute function public.touch_updated_at();
alter table public.foods enable row level security;
create policy foods_read on public.foods for select to authenticated using (user_id is null or user_id = auth.uid());
create policy foods_insert_own on public.foods for insert to authenticated with check (user_id = auth.uid() and source <> 'seed');
create policy foods_update_own on public.foods for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and source <> 'seed');
create policy foods_delete_own on public.foods for delete to authenticated using (user_id = auth.uid());
revoke all on public.foods from anon;

-- ─── Nutrition targets (engine output; a new row whenever they change) ──────────────────────
create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  effective_from date not null,
  kcal integer not null check (kcal between 1000 and 6000),
  protein_g integer not null,
  carbs_g integer not null,
  fat_g integer not null,
  fiber_g integer not null,
  water_ml integer not null,
  bmr integer not null,
  tdee integer not null,
  factor numeric(4, 3) not null,
  surplus integer not null,
  weight_kg numeric(5, 2) not null,
  reason text not null check (reason in ('initial', 'profile', 'weight', 'weekly_adjustment', 'manual')),
  created_at timestamptz not null default now()
);
create index nutrition_targets_user_idx on public.nutrition_targets (user_id, effective_from desc, created_at desc);

-- ─── Weekly meal plans ──────────────────────────────────────────────────────────────────────
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  job_id uuid references public.jobs (id) on delete set null,
  target_id uuid references public.nutrition_targets (id) on delete set null,
  error text,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create trigger meal_plans_touch before update on public.meal_plans
  for each row execute function public.touch_updated_at();

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null references public.meal_plans (id) on delete cascade,
  day_idx integer not null check (day_idx between 0 and 6),   -- 0 = the plan's first day
  idx integer not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack', 'shake')),
  name_fa text not null,
  cook_minutes integer not null default 0,
  kcal numeric(7, 1) not null,
  protein_g numeric(6, 1) not null,
  carbs_g numeric(6, 1) not null,
  fat_g numeric(6, 1) not null,
  swapped_from text,
  unique (plan_id, day_idx, idx)
);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal_id uuid not null references public.meals (id) on delete cascade,
  idx integer not null,
  food_id text not null references public.foods (id) on update cascade,
  grams numeric(6, 1) not null check (grams > 0 and grams <= 3000)
);
create index meal_items_meal_idx on public.meal_items (meal_id, idx);

-- ─── Food log (what was actually eaten) ─────────────────────────────────────────────────────
-- One row per food; rows logged together share entry_id. Macros are computed by the app from
-- the foods table at logging time and stored, so later food edits don't rewrite history.
create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  entry_id uuid not null,
  meal_id uuid references public.meals (id) on delete set null,
  source text not null check (source in ('plan', 'text', 'photo', 'manual')),
  food_id text not null references public.foods (id) on update cascade,
  grams numeric(6, 1) not null check (grams > 0 and grams <= 3000),
  kcal numeric(7, 1) not null,
  protein_g numeric(6, 1) not null,
  carbs_g numeric(6, 1) not null,
  fat_g numeric(6, 1) not null,
  fiber_g numeric(6, 1) not null default 0,
  estimated boolean not null default false,
  label text,
  logged_at timestamptz not null default now()
);
create index food_logs_user_date_idx on public.food_logs (user_id, date);
create index food_logs_entry_idx on public.food_logs (entry_id);

-- ─── RLS: the owner reads and writes only their own rows ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['nutrition_targets', 'meal_plans', 'meals', 'meal_items', 'food_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
