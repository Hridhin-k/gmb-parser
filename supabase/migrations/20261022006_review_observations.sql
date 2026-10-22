-- Review-level intelligence, rebuilt as a data layer.
--
-- grm_reviews stays the source of truth. Each written review can have one
-- current analysis (grm_review_analyses, versioned by analysis_version and
-- tied to the review's content fingerprint). An analysis yields any number
-- of observations (grm_review_observations): one per distinct point the
-- customer made, praise and complaints always as separate rows, each with a
-- verbatim evidence excerpt from the original comment.
--
-- Aggregates are computed from observations at read time; no prose report
-- is stored here. Nothing is filtered by frequency, so a single severe
-- incident is stored the same way as a recurring theme.
--
-- Reverse: drop trigger trg_grm_reviews_stale_analysis on public.grm_reviews;
-- drop function public.grm_mark_review_analysis_stale();
-- drop table public.grm_review_observations;
-- drop table public.grm_review_analyses;

create table if not exists public.grm_review_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  review_id uuid not null references public.grm_reviews(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  analysis_version text not null,
  content_fingerprint text not null,
  status text not null default 'pending',
  model text,
  observation_count integer not null default 0,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grm_review_analyses_status_check check (
    status in ('pending', 'processing', 'ready', 'failed', 'stale', 'no_text')
  ),
  constraint grm_review_analyses_version_unique unique (review_id, analysis_version)
);

-- One live (non-stale, non-failed) analysis per review.
create unique index if not exists grm_review_analyses_one_current
  on public.grm_review_analyses (review_id)
  where status in ('pending', 'processing', 'ready', 'no_text');

create index if not exists grm_review_analyses_workspace_status
  on public.grm_review_analyses (workspace_id, status, updated_at);

create table if not exists public.grm_review_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  analysis_id uuid not null references public.grm_review_analyses(id) on delete cascade,
  review_id uuid not null references public.grm_reviews(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  client_id uuid references public.grm_clients(id) on delete set null,
  group_id uuid references public.grm_groups(id) on delete set null,
  review_create_time timestamptz not null,
  star_rating smallint not null,
  language text,
  topic text not null,
  subtopic text,
  sentiment text not null,
  detail text not null,
  entity_type text,
  entity_name text,
  severity smallint,
  severity_rationale text,
  evidence_excerpt text not null,
  evidence_start integer,
  evidence_end integer,
  basis text not null default 'fact',
  confidence numeric(3, 2),
  is_ambiguous boolean not null default false,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  constraint grm_review_observations_sentiment_check check (
    sentiment in ('positive', 'negative', 'neutral', 'mixed')
  ),
  constraint grm_review_observations_basis_check check (
    basis in ('fact', 'hypothesis')
  ),
  constraint grm_review_observations_severity_check check (
    severity is null or (severity between 1 and 5)
  ),
  constraint grm_review_observations_stars_check check (
    star_rating between 1 and 5
  ),
  constraint grm_review_observations_entity_check check (
    entity_type is null or entity_type in (
      'staff', 'product', 'clothing_category', 'outlet', 'service',
      'billing', 'refund', 'price', 'facility', 'other'
    )
  )
);

-- Reprocessing the same analysis never duplicates an observation.
create unique index if not exists grm_review_observations_dedupe
  on public.grm_review_observations (analysis_id, dedupe_key);

create index if not exists grm_review_observations_scope_time
  on public.grm_review_observations (workspace_id, location_id, review_create_time desc);

create index if not exists grm_review_observations_topic
  on public.grm_review_observations (workspace_id, sentiment, topic);

create index if not exists grm_review_observations_review
  on public.grm_review_observations (review_id);

create index if not exists grm_review_observations_staff
  on public.grm_review_observations (workspace_id, entity_name)
  where entity_type = 'staff';

-- A changed review makes its finished analysis stale. The service role
-- reprocesses it; stale observations stay stored for traceability and are
-- excluded from aggregates because their analysis is no longer current.
create or replace function public.grm_mark_review_analysis_stale()
returns trigger
language plpgsql
as $$
begin
  if new.content_fingerprint is distinct from old.content_fingerprint
     or new.comment is distinct from old.comment
     or new.star_rating is distinct from old.star_rating then
    update public.grm_review_analyses
      set status = 'stale', updated_at = now()
      where review_id = new.id
        and status in ('ready', 'no_text')
        and content_fingerprint is distinct from coalesce(new.content_fingerprint, '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_reviews_stale_analysis on public.grm_reviews;
create trigger trg_grm_reviews_stale_analysis
  after update of content_fingerprint, comment, star_rating on public.grm_reviews
  for each row execute function public.grm_mark_review_analysis_stale();

drop trigger if exists trg_grm_review_analyses_updated_at on public.grm_review_analyses;
create trigger trg_grm_review_analyses_updated_at
  before update on public.grm_review_analyses
  for each row execute function public.grm_set_updated_at();

alter table public.grm_review_analyses enable row level security;
alter table public.grm_review_observations enable row level security;

drop policy if exists "grm: members read review analyses" on public.grm_review_analyses;
create policy "grm: members read review analyses"
  on public.grm_review_analyses
  for select
  using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists "grm: members read review observations" on public.grm_review_observations;
create policy "grm: members read review observations"
  on public.grm_review_observations
  for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
