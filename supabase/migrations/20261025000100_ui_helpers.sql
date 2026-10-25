-- Read helpers for the web UI and the one write users may make to jobs (resume paused work).

create view public.book_progress with (security_invoker = true) as
  select b.id as book_id, b.user_id,
         count(p.id) filter (where p.status <> 'split') as pages_total,
         count(p.id) filter (where p.status = 'translated') as pages_translated,
         count(p.id) filter (where p.status in ('needs_review', 'error')) as pages_attention,
         count(p.id) filter (where p.status in ('uploaded', 'normalizing', 'queued', 'extracting', 'extracted', 'translating')) as pages_active
  from public.books b
  left join public.pages p on p.book_id = b.id
  group by b.id, b.user_id;
grant select on public.book_progress to authenticated;

-- Re-queue the caller's paused jobs (budget cap hit) for one book. Ownership is derived from
-- auth.uid(); the caller cannot name another user.
create or replace function public.resume_paused_jobs(p_book_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.books where id = p_book_id and user_id = auth.uid()) then
    raise exception 'not your book' using errcode = '42501';
  end if;
  update public.jobs set status = 'queued', run_after = now(), last_error = null
  where book_id = p_book_id and user_id = auth.uid() and status = 'paused';
  get diagnostics n = row_count;
  update public.batches set status = 'processing', error = null
  where book_id = p_book_id and user_id = auth.uid() and status = 'paused';
  return n;
end;
$$;
revoke all on function public.resume_paused_jobs(uuid) from public, anon;
grant execute on function public.resume_paused_jobs(uuid) to authenticated;
