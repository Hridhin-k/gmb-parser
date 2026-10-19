-- Tenant AI configuration versions, structured knowledge, draft config pointer, insight feedback.
-- Saved instructions and examples — not model fine-tuning.

create table if not exists public.grm_ai_configs (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.grm_workspaces(id) on delete cascade,
  version         integer     not null,
  status          text        not null check (status in ('draft', 'active', 'archived')),
  label           text        not null default '',
  snapshot        jsonb       not null default '{}'::jsonb,
  created_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, version)
);

create unique index if not exists grm_ai_configs_one_active
  on public.grm_ai_configs (workspace_id)
  where status = 'active';

create index if not exists grm_idx_ai_configs_workspace
  on public.grm_ai_configs (workspace_id, status);

create table if not exists public.grm_ai_knowledge (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.grm_workspaces(id) on delete cascade,
  client_id       uuid        references public.grm_clients(id) on delete cascade,
  group_id        uuid,
  location_id     uuid        references public.grm_google_locations(id) on delete cascade,
  kind            text        not null check (kind in ('instruction', 'faq', 'response_rule', 'approved_example')),
  title           text        not null,
  body            text        not null,
  metadata        jsonb       not null default '{}'::jsonb,
  enabled         boolean     not null default true,
  created_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (
    (client_id is null and group_id is null and location_id is null)
    or (client_id is not null and group_id is null and location_id is null)
    or (client_id is null and group_id is not null and location_id is null)
    or (client_id is null and group_id is null and location_id is not null)
  )
);

create index if not exists grm_idx_ai_knowledge_workspace
  on public.grm_ai_knowledge (workspace_id, kind, enabled);

create table if not exists public.grm_insight_feedback (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.grm_workspaces(id) on delete cascade,
  insight_kind    text        not null check (insight_kind in ('location', 'scope', 'page')),
  scope_id        uuid        not null,
  rating          text        not null check (rating in ('useful', 'not_useful')),
  note            text,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index if not exists grm_idx_insight_feedback_workspace
  on public.grm_insight_feedback (workspace_id, created_at desc);

alter table public.grm_review_ai_drafts
  add column if not exists ai_config_version integer;

comment on table public.grm_ai_configs is
  'Versioned workspace AI configuration snapshots. Active row is used for reply drafting.';
comment on table public.grm_ai_knowledge is
  'Structured tenant knowledge: instructions, FAQs, response rules, approved examples.';
comment on table public.grm_insight_feedback is
  'User ratings of insights. Evaluation only; does not change prompts automatically.';

alter table public.grm_ai_configs enable row level security;
alter table public.grm_ai_knowledge enable row level security;
alter table public.grm_insight_feedback enable row level security;

drop policy if exists grm_ai_configs_select on public.grm_ai_configs;
create policy grm_ai_configs_select on public.grm_ai_configs
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_ai_knowledge_select on public.grm_ai_knowledge;
create policy grm_ai_knowledge_select on public.grm_ai_knowledge
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_insight_feedback_select on public.grm_insight_feedback;
create policy grm_insight_feedback_select on public.grm_insight_feedback
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_ai_configs_updated_at') then
    create trigger trg_grm_ai_configs_updated_at
      before update on public.grm_ai_configs
      for each row execute function public.grm_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_ai_knowledge_updated_at') then
    create trigger trg_grm_ai_knowledge_updated_at
      before update on public.grm_ai_knowledge
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;
