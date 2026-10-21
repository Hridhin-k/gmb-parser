-- Organisation-level summary store: the source of truth for insight counts.
-- One row per (workspace, client) holds the incrementally merged summary
-- state (per-location, per-day counters plus each review's contribution).
-- It is only ever merged with deltas — new, changed, or removed reviews —
-- never recounted wholesale. Scope + window insight summaries are slices
-- of this state.
-- Reverse: drop policy grm_org_summaries_select and table grm_org_summaries.

create table if not exists public.grm_org_summaries (
  workspace_id uuid not null,
  client_id uuid not null,
  state jsonb not null,
  review_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, client_id)
);

alter table public.grm_org_summaries enable row level security;

create policy grm_org_summaries_select on public.grm_org_summaries
  for select using (workspace_id in (select public.grm_my_workspace_ids()));
