-- Durable record of AI-generated content.
-- The generated text is stored here in one fast write before the API responds,
-- then a background persister expands it into drafts / replies / insights.
-- If the background work dies, the row survives and the persister can resume
-- from the stored content without calling the model again.

create table if not exists public.grm_ai_generation_jobs (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.grm_workspaces(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete restrict,
  kind          text        not null check (kind in ('reply', 'location_insight', 'scope_insight')),
  review_id     uuid        references public.grm_reviews(id) on delete cascade,
  location_id   uuid        references public.grm_google_locations(id) on delete cascade,
  scope_kind    text        check (scope_kind in ('client', 'group')),
  scope_id      uuid,
  model         text        not null,
  route         text,
  -- Reply text for kind = 'reply'. Full insight object for insight kinds.
  content       text,
  payload       jsonb       not null default '{}'::jsonb,
  status        text        not null default 'generated'
                check (status in ('generated', 'persisting', 'saved', 'failed', 'superseded')),
  attempts      integer     not null default 0,
  last_error    text,
  draft_id      uuid,
  reply_id      uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.grm_ai_generation_jobs is
  'AI generation outbox: generated content lands here first, background persister saves it into place.';

create index if not exists grm_idx_ai_jobs_status
  on public.grm_ai_generation_jobs (status, updated_at);
create index if not exists grm_idx_ai_jobs_review
  on public.grm_ai_generation_jobs (review_id);

-- Idempotency link from a saved draft back to the job that produced it.
alter table public.grm_review_ai_drafts
  add column if not exists generation_id uuid
  references public.grm_ai_generation_jobs(id) on delete set null;

create unique index if not exists grm_uq_ai_drafts_generation
  on public.grm_review_ai_drafts (generation_id)
  where generation_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_grm_ai_generation_jobs_updated_at'
  ) then
    create trigger trg_grm_ai_generation_jobs_updated_at
      before update on public.grm_ai_generation_jobs
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_ai_generation_jobs enable row level security;

drop policy if exists grm_ai_generation_jobs_select on public.grm_ai_generation_jobs;
create policy grm_ai_generation_jobs_select
  on public.grm_ai_generation_jobs for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
