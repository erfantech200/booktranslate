-- Bookbridge initial schema.
-- Every table carries user_id and has RLS on. The worker connects with the service role / a
-- direct Postgres role that bypasses RLS; the web app connects as the signed-in user.

create extension if not exists pgcrypto;

-- ─── Allowlist (Phase 1) ────────────────────────────────────────────────────────────────────
-- Defence in depth: the web middleware already rejects non-allowlisted emails, but every RLS
-- policy below also requires is_allowed(), so a stray session can't read or write anything.
-- Phase 3 (public signup) replaces is_allowed() with a quota/plan check. No table changes needed.
create table public.app_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.app_allowlist enable row level security;
-- no policies: service role only

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated, service_role;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- ─── User settings ──────────────────────────────────────────────────────────────────────────
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  monthly_budget_usd numeric(10, 2),
  default_target_lang text not null default 'fa',
  ui_locale text not null default 'fa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Books ─────────────────────────────────────────────────────────────────────────────────
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  author text check (char_length(author) <= 300),
  translator_name text check (char_length(translator_name) <= 300),
  source_lang text not null default 'en',
  target_lang text not null default 'fa',
  -- See BookSettings in packages/core/src/types.ts (dialogue register, digits, quality tier, …).
  settings jsonb not null default '{}'::jsonb,
  -- Book brief (genre, era, POV, tone, audience), built on the first batch.
  brief jsonb,
  budget_usd numeric(10, 2),
  cover_page_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_user_idx on public.books (user_id, updated_at desc);

-- ─── Batches (one upload session appended to a book) ────────────────────────────────────────
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  seq integer not null,
  status text not null default 'uploading' check (status in
    ('uploading', 'queued', 'processing', 'translating', 'done', 'needs_review', 'paused', 'error')),
  stage text,
  error text,
  delete_sources_on_complete boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  glossary_hash text,                              -- input hash of the last glossary pass
  sources_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (book_id, seq)
);
create index batches_book_idx on public.batches (book_id, seq);

-- ─── Source files (what the user uploaded: a photo, a PDF, a text file) ────────────────────
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  batch_id uuid not null references public.batches (id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime text,
  size_bytes bigint,
  kind text not null check (kind in ('image', 'pdf', 'epub', 'docx', 'text')),
  upload_index integer not null default 0,
  last_modified timestamptz,
  sha256 text,
  status text not null default 'uploaded' check (status in ('uploaded', 'ingested', 'error', 'deleted')),
  error text,
  created_at timestamptz not null default now(),
  unique (storage_path)
);
create index source_files_batch_idx on public.source_files (batch_id);

-- ─── Pages ─────────────────────────────────────────────────────────────────────────────────
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  batch_id uuid not null references public.batches (id) on delete cascade,
  source_file_id uuid references public.source_files (id) on delete set null,
  -- A two-page spread is split into two child pages; the parent keeps status 'split'.
  parent_page_id uuid references public.pages (id) on delete cascade,
  split_side text check (split_side in ('left', 'right')),
  source_index integer not null default 0,         -- PDF page index, 0 for photos
  original_name text,
  normalized_path text,                            -- 'pages' bucket
  thumb_path text,
  width integer,
  height integer,
  sha256 text,                                     -- of the normalized image or extracted text
  extraction_method text check (extraction_method in ('ocr', 'text_layer')),
  text_layer text,                                 -- raw text for text-layer PDF pages
  exif_taken_at timestamptz,
  printed_page_number integer,
  is_spread boolean,
  quality jsonb,
  extraction jsonb,                                -- validated model output (PageExtraction)
  extract_hash text,                               -- sha256 + model + prompt version
  ordinal double precision,                        -- position in the book (fractional for reorder)
  manual_order boolean not null default false,     -- set by drag-to-reorder; wins over auto order
  status text not null default 'uploaded' check (status in
    ('uploaded', 'normalizing', 'queued', 'extracting', 'extracted', 'split', 'translating',
     'translated', 'needs_review', 'skipped', 'error')),
  error text,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pages_batch_idx on public.pages (batch_id, ordinal);
create index pages_book_idx on public.pages (book_id, ordinal);
create unique index pages_source_unique on public.pages (source_file_id, source_index, coalesce(split_side, ''));

alter table public.books
  add constraint books_cover_fk foreign key (cover_page_id) references public.pages (id) on delete set null;

-- ─── Blocks (the unit of translation, alignment and editing) ───────────────────────────────
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  batch_id uuid not null references public.batches (id) on delete cascade,
  ordinal double precision not null,
  page_ids uuid[] not null,                        -- provenance: every page this block came from
  local_ids text[] not null default '{}',          -- OCR block ids that were merged into it
  type text not null check (type in
    ('heading', 'paragraph', 'quote', 'list_item', 'footnote', 'caption', 'table', 'poem')),
  level integer,
  footnote_marker text,
  source_text text not null,
  source_hash text not null,
  starts_mid_sentence boolean not null default false,
  ends_mid_sentence boolean not null default false,
  translated_text text,
  -- sha256(source + model + prompt/style version + settings + glossary terms occurring in the
  -- block). Adding unrelated glossary terms therefore never invalidates a translation.
  translation_hash text,
  translation_model text,
  translated_at timestamptz,
  user_override text,                              -- never touched by re-runs
  override_at timestamptz,
  translator_notes jsonb not null default '[]'::jsonb,   -- rendered as footnotes ending «—م.»
  lint_flags jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in
    ('pending', 'translated', 'needs_review', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index blocks_book_idx on public.blocks (book_id, ordinal);
create index blocks_batch_idx on public.blocks (batch_id, ordinal);
create index blocks_pages_idx on public.blocks using gin (page_ids);

-- ─── Glossary ──────────────────────────────────────────────────────────────────────────────
create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  source_term text not null check (char_length(source_term) between 1 and 200),
  target_term text not null check (char_length(target_term) between 1 and 200),
  kind text not null default 'term' check (kind in
    ('character', 'place', 'organization', 'term', 'other')),
  notes text check (char_length(notes) <= 1000),
  locked boolean not null default false,
  origin text not null default 'auto' check (origin in ('auto', 'user')),
  first_seen_batch_id uuid references public.batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index glossary_terms_unique on public.glossary_terms (book_id, lower(source_term));

-- ─── Jobs (queue) ──────────────────────────────────────────────────────────────────────────
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid references public.books (id) on delete cascade,
  type text not null check (type in
    ('ingest_batch', 'extract_page', 'assemble_batch', 'glossary_batch', 'translate_batch',
     'render_export', 'retranslate_block', 'cleanup_sources')),
  payload jsonb not null default '{}'::jsonb,
  -- Prevents duplicate live jobs for the same unit of work (e.g. 'extract_page:<page id>').
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
create index jobs_book_idx on public.jobs (book_id, created_at desc);
create unique index jobs_dedupe_live on public.jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running', 'paused');

-- ─── Exports ───────────────────────────────────────────────────────────────────────────────
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  format text not null check (format in ('pdf', 'epub', 'docx', 'html', 'md')),
  scope jsonb not null default '{"type":"book"}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  content_hash text,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'error')),
  storage_path text,
  size_bytes bigint,
  page_count integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index exports_book_idx on public.exports (book_id, created_at desc);

-- ─── Usage log (one row per model call) ────────────────────────────────────────────────────
create table public.usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid references public.books (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  page_id uuid references public.pages (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  stage text not null,
  model text not null,
  mode text not null default 'fast' check (mode in ('fast', 'batch')),
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true,
  request_id text,
  created_at timestamptz not null default now()
);
create index usage_log_book_idx on public.usage_log (book_id, created_at);
create index usage_log_user_month_idx on public.usage_log (user_id, created_at);

-- ─── updated_at triggers ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['user_settings', 'books', 'batches', 'pages', 'blocks',
                           'glossary_terms', 'jobs', 'exports'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- ─── RLS ───────────────────────────────────────────────────────────────────────────────────
alter table public.user_settings enable row level security;
alter table public.books enable row level security;
alter table public.batches enable row level security;
alter table public.source_files enable row level security;
alter table public.pages enable row level security;
alter table public.blocks enable row level security;
alter table public.glossary_terms enable row level security;
alter table public.jobs enable row level security;
alter table public.exports enable row level security;
alter table public.usage_log enable row level security;

-- Full CRUD on rows the user owns.
do $$
declare t text;
begin
  foreach t in array array['user_settings', 'books', 'batches', 'source_files', 'glossary_terms'] loop
    execute format($p$
      create policy owner_select on public.%1$I for select to authenticated
        using (user_id = auth.uid() and public.is_allowed());
      create policy owner_insert on public.%1$I for insert to authenticated
        with check (user_id = auth.uid() and public.is_allowed());
      create policy owner_update on public.%1$I for update to authenticated
        using (user_id = auth.uid() and public.is_allowed())
        with check (user_id = auth.uid() and public.is_allowed());
      create policy owner_delete on public.%1$I for delete to authenticated
        using (user_id = auth.uid() and public.is_allowed());
    $p$, t);
  end loop;
end $$;

-- Pipeline-owned tables: users read; the worker writes. Users may update only the editable
-- columns (column grants below), never status/cost/provenance.
do $$
declare t text;
begin
  foreach t in array array['pages', 'blocks', 'jobs', 'exports', 'usage_log'] loop
    execute format($p$
      create policy owner_select on public.%1$I for select to authenticated
        using (user_id = auth.uid() and public.is_allowed());
    $p$, t);
  end loop;
end $$;

create policy owner_update on public.pages for update to authenticated
  using (user_id = auth.uid() and public.is_allowed())
  with check (user_id = auth.uid() and public.is_allowed());
create policy owner_update on public.blocks for update to authenticated
  using (user_id = auth.uid() and public.is_allowed())
  with check (user_id = auth.uid() and public.is_allowed());
create policy owner_insert on public.jobs for insert to authenticated
  with check (user_id = auth.uid() and public.is_allowed() and status = 'queued' and attempts = 0);
create policy owner_insert on public.exports for insert to authenticated
  with check (user_id = auth.uid() and public.is_allowed() and status = 'queued');

-- Column-level privileges: authenticated users can only change what the UI edits.
revoke update on public.pages from authenticated;
grant update (ordinal, manual_order) on public.pages to authenticated;
revoke update on public.blocks from authenticated;
grant update (user_override, override_at) on public.blocks to authenticated;
revoke all on public.jobs from anon;
revoke update, delete on public.jobs from authenticated;
revoke update, delete on public.exports from authenticated;
revoke insert, update, delete on public.usage_log from authenticated;
revoke all on all tables in schema public from anon;

-- ─── Storage buckets (private) ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('sources', 'sources', false, 104857600),   -- uploads: photos, PDFs (≤100 MB)
  ('pages', 'pages', false, 52428800),        -- normalized page images + thumbnails (worker)
  ('exports', 'exports', false, 209715200)    -- rendered PDF / EPUB (worker)
on conflict (id) do nothing;

-- Object paths always start with '<user_id>/'.
create policy sources_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_allowed());
create policy sources_owner_select on storage.objects for select to authenticated
  using (bucket_id in ('sources', 'pages', 'exports')
         and (storage.foldername(name))[1] = auth.uid()::text and public.is_allowed());
create policy sources_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_allowed());

-- ─── Helper views for the UI ───────────────────────────────────────────────────────────────
-- security_invoker so RLS of the querying user applies.
create view public.book_costs with (security_invoker = true) as
  select book_id, user_id,
         sum(cost_usd) as cost_usd,
         sum(cost_usd) filter (where stage in ('ocr', 'structure')) as extract_cost_usd,
         sum(cost_usd) filter (where stage in ('translate', 'retranslate')) as translate_cost_usd,
         sum(cost_usd) filter (where stage = 'glossary') as glossary_cost_usd,
         sum(input_tokens) as input_tokens,
         sum(cached_tokens) as cached_tokens,
         sum(output_tokens) as output_tokens,
         sum(reasoning_tokens) as reasoning_tokens,
         count(*) as calls
  from public.usage_log
  group by book_id, user_id;

create view public.monthly_costs with (security_invoker = true) as
  select user_id, date_trunc('month', created_at) as month, stage, model,
         sum(cost_usd) as cost_usd, sum(input_tokens) as input_tokens,
         sum(cached_tokens) as cached_tokens, sum(output_tokens) as output_tokens,
         sum(reasoning_tokens) as reasoning_tokens, count(*) as calls
  from public.usage_log
  group by user_id, date_trunc('month', created_at), stage, model;

grant select on public.book_costs, public.monthly_costs to authenticated;
