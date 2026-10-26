-- @destructive
-- @delete-buckets: sources, pages, exports
--
-- Removes Bookbridge, the book translator this project replaced (COACH_SPEC.md, docs/AUDIT.md).
-- Drops every translator table, view, function and storage policy. The runner deletes the three
-- storage buckets and their files through the Storage API just before this SQL runs.
-- No rollback: the translator data (one test book) is discarded on purpose.
-- Kept: public.touch_updated_at() (generic), Supabase Auth users.

drop policy if exists sources_owner_insert on storage.objects;
drop policy if exists sources_owner_select on storage.objects;
drop policy if exists sources_owner_delete on storage.objects;

drop view if exists public.book_progress, public.book_costs, public.monthly_costs;

drop table if exists
  public.blocks, public.glossary_terms, public.exports, public.pages, public.source_files,
  public.batches, public.jobs, public.usage_log, public.user_settings, public.books,
  public.app_allowlist
  cascade;

drop function if exists public.resume_paused_jobs(uuid);
drop function if exists public.is_allowed();
