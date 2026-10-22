-- Insight reports: one saved, evidence-backed synthesis per cache identity
-- (workspace + normalised scope + date range + analysis version + prompt
-- version + model). The unique (workspace_id, cache_key) constraint is the
-- concurrency guard: two simultaneous requests for the same filters resolve
-- to the same row, and only one generation runs.
--
-- A report is 'completed' only when every eligible written review in scope
-- held a current analysis at generation time; otherwise it is 'partial' and
-- says so. Reports store the source-data fingerprint they were built from
-- so a changed review set never silently reuses stale prose.
--
-- Reverse: drop table public.grm_insight_reports;

create table if not exists public.grm_insight_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  cache_key text not null,
  requested_by uuid,
  client_id uuid references public.grm_clients(id) on delete set null,
  group_id uuid references public.grm_groups(id) on delete set null,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  location_ids jsonb not null default '[]'::jsonb,
  range_start timestamptz,
  range_end timestamptz,
  status text not null default 'pending',
  phase text,
  insights jsonb not null default '[]'::jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  data_fingerprint text,
  analysis_version text not null,
  prompt_version text not null,
  model text,
  discovered_count integer not null default 0,
  eligible_count integer not null default 0,
  analysed_count integer not null default 0,
  failed_count integer not null default 0,
  pending_count integer not null default 0,
  failed_review_ids jsonb not null default '[]'::jsonb,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grm_insight_reports_status_check check (
    status in ('pending', 'processing', 'completed', 'partial', 'failed')
  ),
  constraint grm_insight_reports_cache_unique unique (workspace_id, cache_key)
);

create index if not exists grm_insight_reports_workspace_time
  on public.grm_insight_reports (workspace_id, created_at desc);

drop trigger if exists trg_grm_insight_reports_updated_at on public.grm_insight_reports;
create trigger trg_grm_insight_reports_updated_at
  before update on public.grm_insight_reports
  for each row execute function public.grm_set_updated_at();

alter table public.grm_insight_reports enable row level security;

drop policy if exists "grm: members read insight reports" on public.grm_insight_reports;
create policy "grm: members read insight reports"
  on public.grm_insight_reports
  for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
