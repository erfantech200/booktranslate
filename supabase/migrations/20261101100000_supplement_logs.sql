-- "Creatine taken" ticks for the daily supplement card (spec §9: creatine and protein powder only).
-- One row per day and kind; protein powder is logged as food, so only creatine is ticked here.

create table public.supplement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,                                      -- the owner's local date
  kind text not null check (kind in ('creatine')),
  grams numeric(5, 2) check (grams > 0 and grams <= 20),
  created_at timestamptz not null default now(),
  unique (user_id, date, kind)
);

alter table public.supplement_logs enable row level security;
create policy owner_select on public.supplement_logs for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.supplement_logs for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.supplement_logs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.supplement_logs for delete to authenticated using (user_id = auth.uid());
revoke all on public.supplement_logs from anon;
