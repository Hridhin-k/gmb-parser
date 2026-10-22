-- Analysis runs: one row per requested insight analysis over a scope and
-- date range. Per-review success and failure live on grm_review_analyses;
-- this row tracks run-level progress so the UI can show discovered,
-- eligible, already analysed, pending, and failed counts, batch progress,
-- and token usage. A run with any failure ends as 'partial', never
-- 'completed'.
--
-- Reverse: drop table public.grm_analysis_runs;

create table if not exists public.grm_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  requested_by uuid,
  client_id uuid references public.grm_clients(id) on delete set null,
  group_id uuid references public.grm_groups(id) on delete set null,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  range_start timestamptz,
  range_end timestamptz,
  status text not null default 'running',
  discovered integer not null default 0,
  eligible integer not null default 0,
  already_analysed integer not null default 0,
  newly_analysed integer not null default 0,
  pending integer not null default 0,
  failed integer not null default 0,
  batches_total integer not null default 0,
  batches_completed integer not null default 0,
  retries integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grm_analysis_runs_status_check check (
    status in ('running', 'completed', 'partial', 'failed')
  )
);

create index if not exists grm_analysis_runs_workspace_time
  on public.grm_analysis_runs (workspace_id, created_at desc);

drop trigger if exists trg_grm_analysis_runs_updated_at on public.grm_analysis_runs;
create trigger trg_grm_analysis_runs_updated_at
  before update on public.grm_analysis_runs
  for each row execute function public.grm_set_updated_at();

alter table public.grm_analysis_runs enable row level security;

drop policy if exists "grm: members read analysis runs" on public.grm_analysis_runs;
create policy "grm: members read analysis runs"
  on public.grm_analysis_runs
  for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
