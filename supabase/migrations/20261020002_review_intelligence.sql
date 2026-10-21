-- Persistent review intelligence.
-- Additive. Does not change grm_reviews, grm_location_insights, grm_scope_insights,
-- grm_ai_generation_jobs, grm_ai_configs, or grm_ai_knowledge.
--
-- Reverse, in this order, only when no application reads these tables:
--   drop trigger if exists trg_grm_retire_client_summaries on public.grm_clients;
--   drop trigger if exists trg_grm_retire_group_summaries on public.grm_groups;
--   drop trigger if exists trg_grm_retire_location_summaries on public.grm_google_locations;
--   drop trigger if exists trg_grm_note_removed_review_evidence on public.grm_reviews;
--   drop table if exists public.grm_metric_snapshots;
--   drop table if exists public.grm_insight_evidence;
--   drop table if exists public.grm_insight_reports;
--   drop table if exists public.grm_intelligence_jobs;
--   drop table if exists public.grm_cluster_members;
--   drop table if exists public.grm_semantic_clusters;
--   drop table if exists public.grm_review_embeddings;
--   drop table if exists public.grm_review_topic_assignments;
--   drop table if exists public.grm_review_intelligence;
--   drop table if exists public.grm_topic_aliases;
--   drop table if exists public.grm_topics;
--   drop table if exists public.grm_metric_definitions;
--   drop function if exists public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid);
--   drop function if exists public.grm_retire_scope_summaries();
--   drop function if exists public.grm_note_removed_review_evidence();
--   drop function if exists public.grm_guard_metric_snapshot();
--   drop function if exists public.grm_guard_insight_evidence();
--   drop function if exists public.grm_guard_insight_report();
--   drop function if exists public.grm_guard_intelligence_job();
--   drop function if exists public.grm_guard_cluster_member();
--   drop function if exists public.grm_guard_review_embedding();
--   drop function if exists public.grm_guard_topic_assignment();
--   drop function if exists public.grm_guard_topic_alias();
--   drop function if exists public.grm_guard_scope_summary();
--   drop function if exists public.grm_review_intelligence_single_current();
--   drop function if exists public.grm_guard_review_intelligence();
-- Do not drop the vector extension. The shared database may use it elsewhere.

create schema if not exists extensions;

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Platform and tenant topic taxonomy.
-- workspace_id null is the shared taxonomy (codes and aliases only, no review text).
-- A tenant row is an override or an extra topic for that workspace.
-- kind distinguishes a topic from an issue. One assignment table serves both.
-- ---------------------------------------------------------------------------

create table if not exists public.grm_topics (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        references public.grm_workspaces(id) on delete cascade,
  parent_id         uuid        references public.grm_topics(id) on delete restrict,
  code              text        not null check (code ~ '^[a-z0-9_]+$' and char_length(code) between 1 and 64),
  label             text        not null check (char_length(label) between 1 and 120),
  kind              text        not null check (kind in ('topic', 'issue')),
  status            text        not null default 'active' check (status in ('active', 'deprecated')),
  taxonomy_version  text        not null check (char_length(taxonomy_version) between 1 and 64),
  description       text        not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.grm_topics is
  'Canonical topics and issues. A null workspace_id is the platform taxonomy.';

create unique index if not exists grm_topics_code_scope
  on public.grm_topics (
    workspace_id,
    taxonomy_version,
    kind,
    code
  ) nulls not distinct;

create index if not exists grm_idx_topics_parent on public.grm_topics (parent_id);
create index if not exists grm_idx_topics_workspace on public.grm_topics (workspace_id, status);

create table if not exists public.grm_topic_aliases (
  id            uuid        primary key default gen_random_uuid(),
  topic_id      uuid        not null references public.grm_topics(id) on delete cascade,
  workspace_id  uuid        references public.grm_workspaces(id) on delete cascade,
  alias         text        not null check (char_length(alias) between 1 and 80),
  created_at    timestamptz not null default now()
);

comment on table public.grm_topic_aliases is
  'Alternate names for a topic or issue. workspace_id matches the topic.';

create unique index if not exists grm_topic_aliases_norm
  on public.grm_topic_aliases (topic_id, lower(alias));

-- ---------------------------------------------------------------------------
-- One versioned analysis of a source review.
-- content_hash is the review sync_hash (the existing content version).
-- The same review, content hash, and analysis version cannot be stored twice.
-- ---------------------------------------------------------------------------

create table if not exists public.grm_review_intelligence (
  id                       uuid        primary key default gen_random_uuid(),
  workspace_id             uuid        not null references public.grm_workspaces(id) on delete cascade,
  review_id                uuid        not null references public.grm_reviews(id) on delete cascade,
  location_id              uuid        not null references public.grm_google_locations(id) on delete cascade,
  content_hash             text        not null check (char_length(content_hash) between 8 and 128),
  analysis_version         text        not null check (char_length(analysis_version) between 1 and 64),
  taxonomy_version         text        not null check (char_length(taxonomy_version) between 1 and 64),
  prompt_version           text        not null check (char_length(prompt_version) between 1 and 64),
  schema_version           text        not null default 'intelligence-schema-v1',
  model                    text        not null check (char_length(model) between 1 and 80),
  sentiment                text        not null check (sentiment in ('positive', 'mixed', 'negative', 'neutral', 'unknown')),
  status                   text        not null default 'pending' check (status in ('pending', 'ready', 'failed', 'stale')),
  error_class              text        check (error_class is null or error_class in (
                                 'config', 'quota', 'timeout', 'invalid_response', 'safety_blocked', 'unavailable', 'conflict', 'unknown'
                               )),
  is_current               boolean     not null default true,
  ai_config_version        integer,
  knowledge_ids            uuid[]      not null default '{}',
  source_review_update_time timestamptz,
  generated_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (review_id, content_hash, analysis_version),
  foreign key (workspace_id, ai_config_version)
    references public.grm_ai_configs (workspace_id, version)
);

comment on table public.grm_review_intelligence is
  'Versioned reading of one grm_reviews row. Original review text stays on grm_reviews.';

create unique index if not exists grm_review_intelligence_one_current
  on public.grm_review_intelligence (review_id, analysis_version)
  where is_current;

create index if not exists grm_idx_review_intelligence_location
  on public.grm_review_intelligence (workspace_id, location_id, analysis_version, is_current);

create index if not exists grm_idx_review_intelligence_status
  on public.grm_review_intelligence (workspace_id, status, updated_at);

-- Topic and issue links for one intelligence row.
create table if not exists public.grm_review_topic_assignments (
  id               uuid         primary key default gen_random_uuid(),
  workspace_id     uuid         not null references public.grm_workspaces(id) on delete cascade,
  intelligence_id  uuid         not null references public.grm_review_intelligence(id) on delete cascade,
  review_id        uuid         not null references public.grm_reviews(id) on delete cascade,
  topic_id         uuid         not null references public.grm_topics(id) on delete restrict,
  relevance        numeric(4,3) not null check (relevance >= 0 and relevance <= 1),
  sentiment        text         not null check (sentiment in ('positive', 'mixed', 'negative', 'neutral', 'unknown')),
  polarity         text         not null check (polarity in ('praise', 'complaint', 'neutral')),
  excerpt          text         check (excerpt is null or char_length(excerpt) between 1 and 1000),
  created_at       timestamptz  not null default now(),
  unique (intelligence_id, topic_id)
);

comment on table public.grm_review_topic_assignments is
  'Review-to-topic and review-to-issue links. The topic kind says which. excerpt must be copied from the stored review comment.';

create index if not exists grm_idx_topic_assignments_topic
  on public.grm_review_topic_assignments (workspace_id, topic_id, review_id);

create index if not exists grm_idx_topic_assignments_review
  on public.grm_review_topic_assignments (review_id);

-- Semantic clusters. Membership is reviews in this workspace, not a second review store.
create table if not exists public.grm_semantic_clusters (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references public.grm_workspaces(id) on delete cascade,
  cluster_key       text        not null check (char_length(cluster_key) between 1 and 80),
  taxonomy_version  text        not null,
  description       text        not null default '',
  version           integer     not null default 1 check (version >= 1),
  status            text        not null default 'active' check (status in ('active', 'retired')),
  model             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, taxonomy_version, cluster_key, version)
);

create index if not exists grm_idx_semantic_clusters_workspace
  on public.grm_semantic_clusters (workspace_id, status);

create table if not exists public.grm_cluster_members (
  cluster_id       uuid        not null references public.grm_semantic_clusters(id) on delete cascade,
  review_id        uuid        not null references public.grm_reviews(id) on delete cascade,
  workspace_id     uuid        not null references public.grm_workspaces(id) on delete cascade,
  intelligence_id  uuid        references public.grm_review_intelligence(id) on delete set null,
  distance         numeric,
  created_at       timestamptz not null default now(),
  primary key (cluster_id, review_id)
);

create index if not exists grm_idx_cluster_members_review
  on public.grm_cluster_members (workspace_id, review_id);

-- Embeddings live in this database. 768 is the recommended gemini-embedding-001 size.
create table if not exists public.grm_review_embeddings (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.grm_workspaces(id) on delete cascade,
  review_id     uuid        not null references public.grm_reviews(id) on delete cascade,
  content_hash  text        not null check (char_length(content_hash) between 8 and 128),
  model         text        not null check (char_length(model) between 1 and 80),
  dimensions    integer     not null default 768 check (dimensions = 768),
  embedding     extensions.vector(768),
  created_at    timestamptz not null default now(),
  unique (review_id, model, content_hash)
);

comment on table public.grm_review_embeddings is
  'Vector for the readable review comment. Reviewer display names are not part of the hashed source.';

create index if not exists grm_idx_review_embeddings_review
  on public.grm_review_embeddings (workspace_id, review_id);

create index if not exists grm_review_embeddings_hnsw
  on public.grm_review_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

-- ---------------------------------------------------------------------------
-- Scope summaries.
-- Identity is the unique index grm_scope_summaries_identity (NULLS NOT DISTINCT).
-- All-time is range_kind = all and both bounds null. It does not use a fake start date.
-- Bounded windows use an inclusive range_start and an exclusive range_end.
-- timezone is one of the dashboard allow-list. Bounds are absolute instants.
-- Month buckets inside a summary use that timezone, matching grm_dashboard_bundle.
-- membership_basis is current: the location set is whoever is in the scope now.
-- member_location_ids and membership_hash freeze that set on the row.
-- A later move does not rewrite the row. A new hash is a new row, so the old
-- report stays attached to the old summary.
-- ---------------------------------------------------------------------------

create table if not exists public.grm_scope_summaries (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.grm_workspaces(id) on delete cascade,
  client_id           uuid        not null,
  scope_type          text        not null check (scope_type in ('organisation', 'group', 'location')),
  scope_id            uuid        not null,
  group_id            uuid,
  location_id         uuid,
  -- Location summaries keep group_id null (the scope is the outlet). placed_group_id
  -- is the outlet's group at write time so a group manager can still see that outlet.
  placed_group_id     uuid,
  parent_group_id     uuid,
  scope_label         text        not null check (char_length(scope_label) between 1 and 255),
  range_kind          text        not null check (range_kind in ('all', 'bounded')),
  range_start         timestamptz,
  range_end           timestamptz,
  range_label         text        not null default '',
  timezone            text        not null check (timezone in ('Asia/Kolkata', 'UTC', 'Asia/Dubai', 'America/New_York')),
  analysis_version    text        not null,
  taxonomy_version    text        not null,
  schema_version      text        not null default 'intelligence-schema-v1',
  prompt_version      text        not null default '',
  membership_basis    text        not null default 'current' check (membership_basis = 'current'),
  member_location_ids uuid[]      not null default '{}',
  membership_hash     text        not null check (char_length(membership_hash) = 32),
  source_hash         text        not null default '',
  source_review_count integer     not null default 0 check (source_review_count >= 0),
  summary             text        not null default '',
  status              text        not null default 'pending' check (status in ('pending', 'ready', 'failed', 'stale')),
  ai_config_version   integer,
  knowledge_ids       uuid[]      not null default '{}',
  scope_retired_at    timestamptz,
  generated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (
    (range_kind = 'all' and range_start is null and range_end is null)
    or (range_kind = 'bounded' and range_start is not null and range_end is not null and range_start < range_end)
  ),
  check (
    (scope_type = 'organisation' and scope_id = client_id and group_id is null and location_id is null)
    or (scope_type = 'group' and group_id is not null and group_id = scope_id and location_id is null)
    or (scope_type = 'location' and location_id is not null and location_id = scope_id and group_id is null)
  ),
  foreign key (workspace_id, ai_config_version)
    references public.grm_ai_configs (workspace_id, version)
);

comment on table public.grm_scope_summaries is
  'Organisation, group, and location summaries. All-time and each bounded window are different rows. Group membership is the current set, frozen on the row.';

comment on column public.grm_scope_summaries.range_start is
  'Inclusive instant. Null only when range_kind is all.';

comment on column public.grm_scope_summaries.range_end is
  'Exclusive instant. Null only when range_kind is all.';

comment on column public.grm_scope_summaries.timezone is
  'Timezone used to bucket months inside the window. The same allow-list as grm_dashboard_bundle. Bounds themselves are absolute instants.';

create unique index if not exists grm_scope_summaries_identity
  on public.grm_scope_summaries (
    workspace_id,
    scope_type,
    scope_id,
    range_kind,
    range_start,
    range_end,
    timezone,
    analysis_version,
    taxonomy_version,
    schema_version,
    prompt_version,
    membership_hash
  ) nulls not distinct;

create index if not exists grm_idx_scope_summaries_lookup
  on public.grm_scope_summaries (workspace_id, client_id, scope_type, scope_id, range_kind);

create index if not exists grm_idx_scope_summaries_location
  on public.grm_scope_summaries (location_id)
  where location_id is not null;

create table if not exists public.grm_insight_reports (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references public.grm_workspaces(id) on delete cascade,
  summary_id        uuid        not null references public.grm_scope_summaries(id) on delete cascade,
  prompt_version    text        not null,
  model             text        not null,
  status            text        not null default 'pending' check (status in ('pending', 'ready', 'failed', 'stale')),
  findings          jsonb       not null default '[]'::jsonb,
  recommendations   jsonb       not null default '[]'::jsonb,
  metrics           jsonb       not null default '{}'::jsonb,
  generated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (summary_id, prompt_version)
);

comment on table public.grm_insight_reports is
  'Narrative report for one scope summary. A different summary (other window, scope, or membership hash) has its own report.';

create index if not exists grm_idx_insight_reports_workspace
  on public.grm_insight_reports (workspace_id, status, created_at desc);

create table if not exists public.grm_insight_evidence (
  id                 uuid        primary key default gen_random_uuid(),
  workspace_id       uuid        not null references public.grm_workspaces(id) on delete cascade,
  report_id          uuid        not null references public.grm_insight_reports(id) on delete cascade,
  finding_key        text        not null check (char_length(finding_key) between 1 and 80),
  review_id          uuid        references public.grm_reviews(id) on delete set null,
  excerpt            text        check (excerpt is null or char_length(excerpt) between 1 and 1000),
  review_removed_at  timestamptz,
  created_at         timestamptz not null default now(),
  check (review_id is not null or review_removed_at is not null)
);

comment on table public.grm_insight_evidence is
  'Finding-to-review links. Deleting the review keeps the excerpt and marks the report stale.';

create unique index if not exists grm_insight_evidence_link
  on public.grm_insight_evidence (report_id, finding_key, review_id);

create index if not exists grm_idx_insight_evidence_review
  on public.grm_insight_evidence (review_id)
  where review_id is not null;

-- Intelligence pipeline jobs. Reply and on-demand brief jobs stay on grm_ai_generation_jobs.
create table if not exists public.grm_intelligence_jobs (
  id               uuid        primary key default gen_random_uuid(),
  workspace_id     uuid        not null references public.grm_workspaces(id) on delete cascade,
  operation        text        not null check (operation in (
                     'classify_review', 'embed_review', 'build_summary', 'build_report', 'backfill'
                   )),
  status           text        not null default 'queued' check (status in (
                     'queued', 'running', 'succeeded', 'failed', 'cancelled'
                   )),
  attempts         integer     not null default 0 check (attempts >= 0),
  max_attempts     integer     not null default 5 check (max_attempts between 1 and 20),
  error_class      text        check (error_class is null or error_class in (
                     'config', 'quota', 'timeout', 'invalid_response', 'safety_blocked', 'unavailable', 'conflict', 'unknown'
                   )),
  last_error       text,
  review_id        uuid        references public.grm_reviews(id) on delete cascade,
  location_id      uuid        references public.grm_google_locations(id) on delete cascade,
  summary_id       uuid        references public.grm_scope_summaries(id) on delete set null,
  source_hash      text,
  analysis_version text,
  not_before       timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.grm_intelligence_jobs is
  'Classification, embedding, and summary jobs. Freshness is source_hash against the review sync hash or the summary source hash.';

create index if not exists grm_idx_intelligence_jobs_status
  on public.grm_intelligence_jobs (workspace_id, status, created_at);

create index if not exists grm_idx_intelligence_jobs_review
  on public.grm_intelligence_jobs (review_id)
  where review_id is not null;

-- Metric meanings. workspace_id null is the platform definition of a count the dashboard already uses.
create table if not exists public.grm_metric_definitions (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        references public.grm_workspaces(id) on delete cascade,
  metric_key    text        not null check (metric_key ~ '^[a-z0-9_]+$'),
  version       integer     not null check (version >= 1),
  title         text        not null,
  semantics     text        not null,
  requires      jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists grm_metric_definitions_identity
  on public.grm_metric_definitions (workspace_id, metric_key, version) nulls not distinct;

create table if not exists public.grm_metric_snapshots (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.grm_workspaces(id) on delete cascade,
  summary_id     uuid        not null references public.grm_scope_summaries(id) on delete cascade,
  definition_id  uuid        not null references public.grm_metric_definitions(id) on delete restrict,
  value          numeric,
  sample_size    integer     not null default 0 check (sample_size >= 0),
  inputs_hash    text        not null,
  computed_at    timestamptz not null default now(),
  unique (summary_id, definition_id)
);

comment on table public.grm_metric_snapshots is
  'A metric value for one summary. An all-time summary and a 12-month summary do not share a row.';

create index if not exists grm_idx_metric_snapshots_workspace
  on public.grm_metric_snapshots (workspace_id, definition_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create or replace function public.grm_guard_review_intelligence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rev public.grm_reviews%rowtype;
begin
  select * into rev from public.grm_reviews where id = new.review_id;
  if rev.id is null then
    raise exception 'Review not found';
  end if;
  if rev.workspace_id is distinct from new.workspace_id then
    raise exception 'Review belongs to another workspace';
  end if;
  if rev.location_id is distinct from new.location_id then
    raise exception 'Intelligence location must match the review';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_review_intelligence on public.grm_review_intelligence;
create trigger trg_grm_guard_review_intelligence
  before insert or update of review_id, workspace_id, location_id
  on public.grm_review_intelligence
  for each row execute function public.grm_guard_review_intelligence();

create or replace function public.grm_review_intelligence_single_current()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_current then
    update public.grm_review_intelligence
    set is_current = false
    where review_id = new.review_id
      and analysis_version = new.analysis_version
      and id is distinct from new.id
      and is_current;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_review_intelligence_single_current on public.grm_review_intelligence;
create trigger trg_grm_review_intelligence_single_current
  before insert or update of is_current
  on public.grm_review_intelligence
  for each row execute function public.grm_review_intelligence_single_current();

create or replace function public.grm_guard_topic_alias()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  topic_workspace uuid;
begin
  select workspace_id into topic_workspace from public.grm_topics where id = new.topic_id;
  if not found then
    raise exception 'Topic not found';
  end if;
  if topic_workspace is distinct from new.workspace_id then
    raise exception 'Alias workspace must match the topic';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_topic_alias on public.grm_topic_aliases;
create trigger trg_grm_guard_topic_alias
  before insert or update on public.grm_topic_aliases
  for each row execute function public.grm_guard_topic_alias();

create or replace function public.grm_guard_topic_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  intel public.grm_review_intelligence%rowtype;
  topic_workspace uuid;
  body text;
begin
  select * into intel from public.grm_review_intelligence where id = new.intelligence_id;
  if intel.id is null then
    raise exception 'Intelligence row not found';
  end if;
  if intel.workspace_id is distinct from new.workspace_id or intel.review_id is distinct from new.review_id then
    raise exception 'Assignment must match the intelligence row workspace and review';
  end if;
  select workspace_id into topic_workspace from public.grm_topics where id = new.topic_id;
  if not found then
    raise exception 'Topic not found';
  end if;
  if topic_workspace is not null and topic_workspace is distinct from new.workspace_id then
    raise exception 'Topic belongs to another workspace';
  end if;
  if new.excerpt is not null then
    select comment into body from public.grm_reviews where id = new.review_id;
    if body is null or strpos(body, new.excerpt) = 0 then
      raise exception 'Excerpt is not contained in the stored review comment';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_topic_assignment on public.grm_review_topic_assignments;
create trigger trg_grm_guard_topic_assignment
  before insert or update on public.grm_review_topic_assignments
  for each row execute function public.grm_guard_topic_assignment();

create or replace function public.grm_guard_review_embedding()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rev_workspace uuid;
begin
  select workspace_id into rev_workspace from public.grm_reviews where id = new.review_id;
  if rev_workspace is null or rev_workspace is distinct from new.workspace_id then
    raise exception 'Embedding workspace must match the review';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_review_embedding on public.grm_review_embeddings;
create trigger trg_grm_guard_review_embedding
  before insert or update of review_id, workspace_id
  on public.grm_review_embeddings
  for each row execute function public.grm_guard_review_embedding();

create or replace function public.grm_guard_cluster_member()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cluster_workspace uuid;
  rev_workspace uuid;
begin
  select workspace_id into cluster_workspace from public.grm_semantic_clusters where id = new.cluster_id;
  select workspace_id into rev_workspace from public.grm_reviews where id = new.review_id;
  if cluster_workspace is distinct from new.workspace_id or rev_workspace is distinct from new.workspace_id then
    raise exception 'Cluster membership must stay inside one workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_cluster_member on public.grm_cluster_members;
create trigger trg_grm_guard_cluster_member
  before insert or update on public.grm_cluster_members
  for each row execute function public.grm_guard_cluster_member();

create or replace function public.grm_guard_scope_summary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  client_workspace uuid;
  group_workspace uuid;
  group_client uuid;
  group_parent uuid;
  loc_workspace uuid;
  loc_client uuid;
  loc_group uuid;
  loc_parent uuid;
begin
  if tg_op = 'UPDATE' and new.scope_retired_at is not null then
    return new;
  end if;

  select workspace_id into client_workspace from public.grm_clients where id = new.client_id;
  if client_workspace is null or client_workspace is distinct from new.workspace_id then
    raise exception 'Organisation is not in this workspace';
  end if;

  if new.scope_type = 'organisation' then
    if new.scope_id is distinct from new.client_id then
      raise exception 'Organisation scope id must be the client id';
    end if;
    new.group_id := null;
    new.location_id := null;
    return new;
  end if;

  if new.scope_type = 'group' then
    select workspace_id, client_id, parent_id
      into group_workspace, group_client, group_parent
    from public.grm_groups
    where id = new.scope_id;
    if group_workspace is null or group_workspace is distinct from new.workspace_id then
      raise exception 'Group is not in this workspace';
    end if;
    if group_client is distinct from new.client_id then
      raise exception 'Group belongs to another organisation';
    end if;
    new.group_id := new.scope_id;
    new.location_id := null;
    new.parent_group_id := group_parent;
    return new;
  end if;

  select l.workspace_id, l.client_id, l.group_id, g.parent_id
    into loc_workspace, loc_client, loc_group, loc_parent
  from public.grm_google_locations l
  left join public.grm_groups g on g.id = l.group_id
  where l.id = new.scope_id;
  if loc_workspace is null or loc_workspace is distinct from new.workspace_id then
    raise exception 'Location is not in this workspace';
  end if;
  if loc_client is distinct from new.client_id then
    raise exception 'Location belongs to another organisation';
  end if;
  new.location_id := new.scope_id;
  new.group_id := null;
  new.placed_group_id := loc_group;
  new.parent_group_id := loc_parent;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_scope_summary on public.grm_scope_summaries;
create trigger trg_grm_guard_scope_summary
  before insert or update of workspace_id, client_id, scope_type, scope_id, scope_retired_at
  on public.grm_scope_summaries
  for each row execute function public.grm_guard_scope_summary();

create or replace function public.grm_guard_insight_report()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  summary_workspace uuid;
begin
  select workspace_id into summary_workspace from public.grm_scope_summaries where id = new.summary_id;
  if summary_workspace is null or summary_workspace is distinct from new.workspace_id then
    raise exception 'Report workspace must match the summary';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_insight_report on public.grm_insight_reports;
create trigger trg_grm_guard_insight_report
  before insert or update of workspace_id, summary_id
  on public.grm_insight_reports
  for each row execute function public.grm_guard_insight_report();

create or replace function public.grm_guard_insight_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  report_workspace uuid;
  body text;
begin
  select workspace_id into report_workspace from public.grm_insight_reports where id = new.report_id;
  if report_workspace is null or report_workspace is distinct from new.workspace_id then
    raise exception 'Evidence workspace must match the report';
  end if;
  if new.review_id is not null and new.excerpt is not null then
    select comment into body from public.grm_reviews where id = new.review_id and workspace_id = new.workspace_id;
    if body is null or strpos(body, new.excerpt) = 0 then
      raise exception 'Excerpt is not contained in the stored review comment';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_insight_evidence on public.grm_insight_evidence;
create trigger trg_grm_guard_insight_evidence
  before insert or update on public.grm_insight_evidence
  for each row execute function public.grm_guard_insight_evidence();

create or replace function public.grm_guard_metric_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  summary_workspace uuid;
  definition_workspace uuid;
begin
  select workspace_id into summary_workspace from public.grm_scope_summaries where id = new.summary_id;
  if summary_workspace is null or summary_workspace is distinct from new.workspace_id then
    raise exception 'Snapshot workspace must match the summary';
  end if;
  select workspace_id into definition_workspace from public.grm_metric_definitions where id = new.definition_id;
  if definition_workspace is not null and definition_workspace is distinct from new.workspace_id then
    raise exception 'Metric definition belongs to another workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_metric_snapshot on public.grm_metric_snapshots;
create trigger trg_grm_guard_metric_snapshot
  before insert or update on public.grm_metric_snapshots
  for each row execute function public.grm_guard_metric_snapshot();

create or replace function public.grm_guard_intelligence_job()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rev_workspace uuid;
  loc_workspace uuid;
  summary_workspace uuid;
begin
  if new.review_id is not null then
    select workspace_id into rev_workspace from public.grm_reviews where id = new.review_id;
    if rev_workspace is distinct from new.workspace_id then
      raise exception 'Job review belongs to another workspace';
    end if;
  end if;
  if new.location_id is not null then
    select workspace_id into loc_workspace from public.grm_google_locations where id = new.location_id;
    if loc_workspace is distinct from new.workspace_id then
      raise exception 'Job location belongs to another workspace';
    end if;
  end if;
  if new.summary_id is not null then
    select workspace_id into summary_workspace from public.grm_scope_summaries where id = new.summary_id;
    if summary_workspace is distinct from new.workspace_id then
      raise exception 'Job summary belongs to another workspace';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_guard_intelligence_job on public.grm_intelligence_jobs;
create trigger trg_grm_guard_intelligence_job
  before insert or update of workspace_id, review_id, location_id, summary_id
  on public.grm_intelligence_jobs
  for each row execute function public.grm_guard_intelligence_job();

-- Keep the excerpt when the review row goes away, and stop treating the report as current.
create or replace function public.grm_note_removed_review_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.grm_insight_reports r
  set status = 'stale'
  from public.grm_insight_evidence e
  where e.review_id = old.id
    and e.report_id = r.id
    and r.status = 'ready';

  update public.grm_insight_evidence
  set review_removed_at = coalesce(review_removed_at, now())
  where review_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_grm_note_removed_review_evidence on public.grm_reviews;
create trigger trg_grm_note_removed_review_evidence
  before delete on public.grm_reviews
  for each row execute function public.grm_note_removed_review_evidence();

-- Group, location, and client deletes already exist in the app. Summaries stay,
-- with scope_retired_at set, so those deletes do not start failing.
create or replace function public.grm_retire_scope_summaries()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'grm_groups' then
    update public.grm_scope_summaries
    set scope_retired_at = coalesce(scope_retired_at, now()),
        status = case when status = 'ready' then 'stale' else status end
    where workspace_id = old.workspace_id
      and scope_type = 'group'
      and scope_id = old.id;
  elsif tg_table_name = 'grm_google_locations' then
    update public.grm_scope_summaries
    set scope_retired_at = coalesce(scope_retired_at, now()),
        status = case when status = 'ready' then 'stale' else status end
    where workspace_id = old.workspace_id
      and scope_type = 'location'
      and scope_id = old.id;
  elsif tg_table_name = 'grm_clients' then
    update public.grm_scope_summaries
    set scope_retired_at = coalesce(scope_retired_at, now()),
        status = case when status = 'ready' then 'stale' else status end
    where workspace_id = old.workspace_id
      and client_id = old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_grm_retire_group_summaries on public.grm_groups;
create trigger trg_grm_retire_group_summaries
  before delete on public.grm_groups
  for each row execute function public.grm_retire_scope_summaries();

drop trigger if exists trg_grm_retire_location_summaries on public.grm_google_locations;
create trigger trg_grm_retire_location_summaries
  before delete on public.grm_google_locations
  for each row execute function public.grm_retire_scope_summaries();

drop trigger if exists trg_grm_retire_client_summaries on public.grm_clients;
create trigger trg_grm_retire_client_summaries
  before delete on public.grm_clients
  for each row execute function public.grm_retire_scope_summaries();

-- Stale the report when the summary's source hash changes.
create or replace function public.grm_stale_report_on_summary_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_hash is distinct from old.source_hash or new.membership_hash is distinct from old.membership_hash then
    update public.grm_insight_reports
    set status = 'stale'
    where summary_id = new.id
      and status = 'ready';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grm_stale_report_on_summary_change on public.grm_scope_summaries;
create trigger trg_grm_stale_report_on_summary_change
  after update of source_hash, membership_hash
  on public.grm_scope_summaries
  for each row execute function public.grm_stale_report_on_summary_change();

-- ---------------------------------------------------------------------------
-- Visibility. Store managers see a location summary, not the organisation rollup.
-- ---------------------------------------------------------------------------

create or replace function public.grm_can_see_scope_summary(
  p_workspace uuid,
  p_scope_type text,
  p_client uuid,
  p_group uuid,
  p_location uuid,
  p_parent_group uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grm_workspace_members m
    where m.user_id = auth.uid()
      and m.workspace_id = p_workspace
      and m.access_enabled
      and (
        (m.scope_client_id is null and m.scope_group_id is null and m.scope_location_id is null)
        or (
          p_scope_type = 'organisation'
          and m.scope_client_id = p_client
          and m.scope_group_id is null
          and m.scope_location_id is null
        )
        or (
          p_scope_type = 'group'
          and m.scope_location_id is null
          and (
            m.scope_client_id = p_client
            or m.scope_group_id = p_group
            or (p_parent_group is not null and m.scope_group_id = p_parent_group)
          )
        )
        or (
          p_scope_type = 'location'
          and public.grm_can_see_location(p_workspace, p_client, p_group, p_location)
        )
      )
  );
$$;

comment on function public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) is
  'Who may read a scope summary. A location lock does not reveal the organisation or group rollup.';

revoke all on function public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security. Writes stay on the service role, as with the other GRM tables.
-- ---------------------------------------------------------------------------

alter table public.grm_topics enable row level security;
alter table public.grm_topic_aliases enable row level security;
alter table public.grm_review_intelligence enable row level security;
alter table public.grm_review_topic_assignments enable row level security;
alter table public.grm_semantic_clusters enable row level security;
alter table public.grm_cluster_members enable row level security;
alter table public.grm_review_embeddings enable row level security;
alter table public.grm_scope_summaries enable row level security;
alter table public.grm_insight_reports enable row level security;
alter table public.grm_insight_evidence enable row level security;
alter table public.grm_intelligence_jobs enable row level security;
alter table public.grm_metric_definitions enable row level security;
alter table public.grm_metric_snapshots enable row level security;

drop policy if exists grm_topics_select on public.grm_topics;
create policy grm_topics_select on public.grm_topics
  for select using (
    (workspace_id is null and exists (select 1 from public.grm_my_workspace_ids()))
    or workspace_id in (select public.grm_my_workspace_ids())
  );

drop policy if exists grm_topic_aliases_select on public.grm_topic_aliases;
create policy grm_topic_aliases_select on public.grm_topic_aliases
  for select using (
    exists (
      select 1 from public.grm_topics t
      where t.id = topic_id
        and (
          (t.workspace_id is null and exists (select 1 from public.grm_my_workspace_ids()))
          or t.workspace_id in (select public.grm_my_workspace_ids())
        )
    )
  );

drop policy if exists grm_review_intelligence_select on public.grm_review_intelligence;
create policy grm_review_intelligence_select on public.grm_review_intelligence
  for select using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.id = location_id
        and l.workspace_id = grm_review_intelligence.workspace_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_review_topic_assignments_select on public.grm_review_topic_assignments;
create policy grm_review_topic_assignments_select on public.grm_review_topic_assignments
  for select using (
    exists (
      select 1
      from public.grm_review_intelligence i
      join public.grm_google_locations l on l.id = i.location_id
      where i.id = intelligence_id
        and i.workspace_id = grm_review_topic_assignments.workspace_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_semantic_clusters_select on public.grm_semantic_clusters;
create policy grm_semantic_clusters_select on public.grm_semantic_clusters
  for select using (
    exists (
      select 1
      from public.grm_workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id = grm_semantic_clusters.workspace_id
        and m.access_enabled
        and m.scope_client_id is null
        and m.scope_group_id is null
        and m.scope_location_id is null
    )
    or exists (
      select 1
      from public.grm_cluster_members cm
      join public.grm_reviews r on r.id = cm.review_id
      join public.grm_google_locations l on l.id = r.location_id
      where cm.cluster_id = grm_semantic_clusters.id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_cluster_members_select on public.grm_cluster_members;
create policy grm_cluster_members_select on public.grm_cluster_members
  for select using (
    exists (
      select 1
      from public.grm_reviews r
      join public.grm_google_locations l on l.id = r.location_id
      where r.id = review_id
        and r.workspace_id = grm_cluster_members.workspace_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_review_embeddings_select on public.grm_review_embeddings;
create policy grm_review_embeddings_select on public.grm_review_embeddings
  for select using (
    exists (
      select 1
      from public.grm_reviews r
      join public.grm_google_locations l on l.id = r.location_id
      where r.id = review_id
        and r.workspace_id = grm_review_embeddings.workspace_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_scope_summaries_select on public.grm_scope_summaries;
create policy grm_scope_summaries_select on public.grm_scope_summaries
  for select using (
    public.grm_can_see_scope_summary(
      workspace_id,
      scope_type,
      client_id,
      case when scope_type = 'location' then placed_group_id else group_id end,
      location_id,
      parent_group_id
    )
  );

drop policy if exists grm_insight_reports_select on public.grm_insight_reports;
create policy grm_insight_reports_select on public.grm_insight_reports
  for select using (
    exists (
      select 1
      from public.grm_scope_summaries s
      where s.id = summary_id
        and s.workspace_id = grm_insight_reports.workspace_id
        and public.grm_can_see_scope_summary(
          s.workspace_id,
          s.scope_type,
          s.client_id,
          case when s.scope_type = 'location' then s.placed_group_id else s.group_id end,
          s.location_id,
          s.parent_group_id
        )
    )
  );

drop policy if exists grm_insight_evidence_select on public.grm_insight_evidence;
create policy grm_insight_evidence_select on public.grm_insight_evidence
  for select using (
    exists (
      select 1
      from public.grm_insight_reports r
      join public.grm_scope_summaries s on s.id = r.summary_id
      where r.id = report_id
        and r.workspace_id = grm_insight_evidence.workspace_id
        and public.grm_can_see_scope_summary(
          s.workspace_id,
          s.scope_type,
          s.client_id,
          case when s.scope_type = 'location' then s.placed_group_id else s.group_id end,
          s.location_id,
          s.parent_group_id
        )
    )
  );

drop policy if exists grm_intelligence_jobs_select on public.grm_intelligence_jobs;
create policy grm_intelligence_jobs_select on public.grm_intelligence_jobs
  for select using (
    (
      review_id is not null
      and exists (
        select 1
        from public.grm_reviews r
        join public.grm_google_locations l on l.id = r.location_id
        where r.id = grm_intelligence_jobs.review_id
          and r.workspace_id = grm_intelligence_jobs.workspace_id
          and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
      )
    )
    or (
      review_id is null
      and summary_id is not null
      and exists (
        select 1
        from public.grm_scope_summaries s
        where s.id = summary_id
          and public.grm_can_see_scope_summary(
            s.workspace_id,
          s.scope_type,
          s.client_id,
          case when s.scope_type = 'location' then s.placed_group_id else s.group_id end,
          s.location_id,
          s.parent_group_id
          )
      )
    )
    or (
      review_id is null
      and summary_id is null
      and exists (
        select 1
        from public.grm_workspace_members m
        where m.user_id = auth.uid()
          and m.workspace_id = grm_intelligence_jobs.workspace_id
          and m.access_enabled
          and m.scope_client_id is null
          and m.scope_group_id is null
          and m.scope_location_id is null
      )
    )
  );

drop policy if exists grm_metric_definitions_select on public.grm_metric_definitions;
create policy grm_metric_definitions_select on public.grm_metric_definitions
  for select using (
    (workspace_id is null and exists (select 1 from public.grm_my_workspace_ids()))
    or workspace_id in (select public.grm_my_workspace_ids())
  );

drop policy if exists grm_metric_snapshots_select on public.grm_metric_snapshots;
create policy grm_metric_snapshots_select on public.grm_metric_snapshots
  for select using (
    exists (
      select 1
      from public.grm_scope_summaries s
      where s.id = summary_id
        and s.workspace_id = grm_metric_snapshots.workspace_id
        and public.grm_can_see_scope_summary(
          s.workspace_id,
          s.scope_type,
          s.client_id,
          case when s.scope_type = 'location' then s.placed_group_id else s.group_id end,
          s.location_id,
          s.parent_group_id
        )
    )
  );

-- updated_at
do $$
declare
  item text;
begin
  foreach item in array array[
    'grm_topics',
    'grm_review_intelligence',
    'grm_semantic_clusters',
    'grm_scope_summaries',
    'grm_insight_reports',
    'grm_intelligence_jobs'
  ]
  loop
    if not exists (select 1 from pg_trigger where tgname = 'trg_' || item || '_updated_at') then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.grm_set_updated_at()',
        'trg_' || item || '_updated_at',
        item
      );
    end if;
  end loop;
end $$;

-- Platform taxonomy. Codes match the closed set from the architecture audit.
insert into public.grm_topics (workspace_id, code, label, kind, taxonomy_version, description)
select null, code, label, kind, 'taxonomy-v1', ''
from (
  values
    ('staff', 'Staff', 'topic'),
    ('billing', 'Billing queue', 'topic'),
    ('parking', 'Parking', 'topic'),
    ('exchange', 'Exchange policy', 'topic'),
    ('quality', 'Product quality', 'topic'),
    ('cleanliness', 'Cleanliness', 'topic'),
    ('price', 'Price', 'topic'),
    ('other', 'Other', 'topic'),
    ('staff', 'Staff', 'issue'),
    ('billing', 'Billing queue', 'issue'),
    ('parking', 'Parking', 'issue'),
    ('exchange', 'Exchange policy', 'issue'),
    ('quality', 'Product quality', 'issue'),
    ('cleanliness', 'Cleanliness', 'issue'),
    ('price', 'Price', 'issue')
) as seed(code, label, kind)
where not exists (
  select 1 from public.grm_topics t
  where t.workspace_id is null
    and t.taxonomy_version = 'taxonomy-v1'
    and t.kind = seed.kind
    and t.code = seed.code
);

insert into public.grm_topic_aliases (topic_id, workspace_id, alias)
select t.id, null, alias
from (
  values
    ('billing', 'topic', 'wait'),
    ('billing', 'topic', 'billing queue'),
    ('staff', 'topic', 'staff behaviour'),
    ('exchange', 'topic', 'exchange policy'),
    ('quality', 'topic', 'product quality'),
    ('cleanliness', 'topic', 'hygiene'),
    ('price', 'topic', 'expensive')
) as seed(code, kind, alias)
join public.grm_topics t
  on t.workspace_id is null
 and t.taxonomy_version = 'taxonomy-v1'
 and t.kind = seed.kind
 and t.code = seed.code
where not exists (
  select 1 from public.grm_topic_aliases a
  where a.topic_id = t.id and lower(a.alias) = lower(seed.alias)
);

-- Platform metric definitions. Semantics match grm_dashboard_bundle.
insert into public.grm_metric_definitions (workspace_id, metric_key, version, title, semantics, requires)
select null, metric_key, 1, title, semantics, requires::jsonb
from (
  values
    (
      'review_count',
      'Reviews',
      'Count of grm_reviews whose review_create_time is inside the summary window and whose location_id is in member_location_ids.',
      '["review_create_time","location_id"]'
    ),
    (
      'average_rating',
      'Average rating',
      'Sum of star_rating divided by review_count. Null when review_count is 0. Not an average of location averages.',
      '["star_rating","review_create_time","location_id"]'
    ),
    (
      'negative_share',
      '1–3 star share',
      'Reviews with star_rating <= 3 divided by review_count. Null when review_count is 0.',
      '["star_rating","review_create_time","location_id"]'
    ),
    (
      'reply_rate',
      'Reply rate',
      'Reviews with a Google reply comment, or reply_status = published, divided by review_count. Null when review_count is 0.',
      '["google_reply_comment","reply_status","review_create_time","location_id"]'
    )
) as seed(metric_key, title, semantics, requires)
where not exists (
  select 1 from public.grm_metric_definitions d
  where d.workspace_id is null and d.metric_key = seed.metric_key and d.version = 1
);
