-- Several training programs side by side (e.g. a gym plan and a home plan). A program holds the
-- schedule and equipment settings; its blocks (mesocycles) are built from them. One program is
-- active at a time; a paused program keeps its current block and resumes at the week it left off.
--
-- Not destructive: no data is removed. The one-active-block-per-user index becomes one per program
-- (a relaxed constraint), and the ended_reason check gains the value 'deleted'.

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text check (name is null or char_length(name) between 1 and 60), -- null: the UI shows a label from the settings
  active boolean not null default false,
  train_location text not null check (train_location in ('gym', 'home')),
  equipment text[] not null default '{}',
  days_per_week integer not null check (days_per_week between 1 and 7),
  session_minutes integer not null check (session_minutes between 15 and 180),
  preferred_days integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index programs_one_active on public.programs (user_id) where active;
create index programs_user_idx on public.programs (user_id, created_at);
create trigger programs_touch before update on public.programs
  for each row execute function public.touch_updated_at();

alter table public.programs enable row level security;
create policy owner_select on public.programs for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.programs for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.programs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.programs for delete to authenticated using (user_id = auth.uid());
revoke all on public.programs from anon;

-- Blocks belong to a program. A deleted program's finished workouts stay in history: its blocks
-- that hold them lose the link (program_id null) instead of being removed.
alter table public.mesocycles add column program_id uuid references public.programs (id) on delete set null;
alter table public.mesocycles add column paused_at date; -- set while its program is not the active one
create index mesocycles_program_idx on public.mesocycles (program_id, seq);

alter table public.mesocycles drop constraint mesocycles_ended_reason_check;
alter table public.mesocycles add constraint mesocycles_ended_reason_check
  check (ended_reason in ('completed', 'rebuilt', 'deleted'));

-- Existing blocks: one program per owner, from the profile's current settings, active.
insert into public.programs (user_id, active, train_location, equipment, days_per_week, session_minutes, preferred_days)
select p.user_id, true, coalesce(p.train_location, 'gym'), coalesce(p.equipment, '{}'),
       coalesce(p.days_per_week, 3), coalesce(p.session_minutes, 60), coalesce(p.preferred_days, '{}')
from public.profile p
where exists (select 1 from public.mesocycles m where m.user_id = p.user_id);
update public.mesocycles m set program_id = pr.id
from public.programs pr where pr.user_id = m.user_id and m.program_id is null;

drop index public.mesocycles_one_active;
create unique index mesocycles_one_active on public.mesocycles (program_id) where status = 'active';
