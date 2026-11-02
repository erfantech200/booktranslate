-- Phase 5 (spec §7, §11, §12, §14): weekly check-ins, proposed changes with an audit trail, coach
-- chat history, the check-in weekday, and the private bucket for exercise illustrations.
-- Not destructive: new tables, one new profile column with a default, one bucket.

-- The weekday the weekly check-in runs (0 = Saturday … 6 = Friday, the end of the Persian week).
alter table public.profile add column checkin_weekday smallint not null default 6 check (checkin_weekday between 0 and 6);

-- ─── Weekly check-ins ────────────────────────────────────────────────────────────────────────
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_end date not null,                                  -- last day of the reviewed week (local date)
  report jsonb not null,                                   -- the engine's numbers (CheckinReport)
  narrative jsonb,                                         -- the model's wording of the report
  narrative_status text not null default 'pending' check (narrative_status in ('pending', 'ok', 'failed')),
  created_at timestamptz not null default now(),
  unique (user_id, week_end)
);
create index checkins_user_idx on public.checkins (user_id, week_end desc);

-- ─── Coach chat ──────────────────────────────────────────────────────────────────────────────
create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  created_at timestamptz not null default now()
);
create index coach_messages_user_idx on public.coach_messages (user_id, created_at desc);

-- ─── Proposed changes (check-in and coach), applied only on the owner's tap ──────────────────
create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('checkin', 'coach')),
  checkin_id uuid references public.checkins (id) on delete cascade,
  message_id uuid references public.coach_messages (id) on delete cascade,
  type text not null check (type in ('calories', 'swap_exercise', 'early_deload', 'reschedule_workout', 'add_note', 'regenerate_meal')),
  before jsonb,
  after jsonb not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index adjustments_user_idx on public.adjustments (user_id, created_at desc);
create index adjustments_checkin_idx on public.adjustments (checkin_id);
create index adjustments_message_idx on public.adjustments (message_id);

do $$
declare t text;
begin
  foreach t in array array['checkins', 'coach_messages', 'adjustments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ─── Exercise illustrations (spec §7) ────────────────────────────────────────────────────────
-- Shared like the exercise seed: signed-in users read through short-lived signed URLs, only the
-- service role writes (generation runs server-side).
insert into storage.buckets (id, name, public, file_size_limit)
values ('exercise-images', 'exercise-images', false, 10485760)
on conflict (id) do nothing;
create policy exercise_images_read on storage.objects for select to authenticated
  using (bucket_id = 'exercise-images');
