-- Full-text search columns + indexes (searched via search.videos tRPC proc).

-- array_to_string() is only marked STABLE (it accepts anyarray, whose element
-- output functions can be locale/timezone-dependent), so it can't be used
-- directly in a GENERATED ... STORED expression. For a text[] of tags the
-- operation is genuinely immutable, so we wrap it in an immutable SQL function.
create or replace function public.immutable_array_to_string(arr text[], sep text)
returns text language sql immutable parallel safe as $$
  select array_to_string(arr, sep);
$$;

alter table public.videos
  add column if not exists fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(public.immutable_array_to_string(tags, ' '), '')), 'B')
  ) stored;

create index if not exists videos_fts_idx on public.videos using gin (fts);

alter table public.transcripts
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(full_text, ''))) stored;

create index if not exists transcripts_fts_idx on public.transcripts using gin (fts);

alter table public.ai_outputs
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(content_text, ''))) stored;

create index if not exists ai_outputs_fts_idx on public.ai_outputs using gin (fts);

-- Comments are searchable too (workspace search includes them).
alter table public.comments
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index if not exists comments_fts_idx on public.comments using gin (fts);
