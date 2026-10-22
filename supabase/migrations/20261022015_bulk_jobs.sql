-- Durable queue for bulk reply actions (generate / publish).
-- The HTTP request only enqueues; a background worker processes the reviews
-- with bounded concurrency and stores per-item results here for polling.
-- If the worker dies, the row survives and the poll endpoint re-kicks it.

create table if not exists public.grm_bulk_jobs (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.grm_workspaces(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete restrict,
  action        text        not null check (action in ('generate', 'publish')),
  review_ids    jsonb       not null default '[]'::jsonb,
  results       jsonb       not null default '[]'::jsonb,
  status        text        not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed')),
  succeeded     integer     not null default 0,
  failed        integer     not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.grm_bulk_jobs is
  'Bulk reply action queue: request enqueues, background worker processes with bounded concurrency, clients poll for results.';

create index if not exists grm_idx_bulk_jobs_status
  on public.grm_bulk_jobs (status, updated_at);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_grm_bulk_jobs_updated_at'
  ) then
    create trigger trg_grm_bulk_jobs_updated_at
      before update on public.grm_bulk_jobs
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_bulk_jobs enable row level security;

drop policy if exists grm_bulk_jobs_select on public.grm_bulk_jobs;
create policy grm_bulk_jobs_select
  on public.grm_bulk_jobs for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
