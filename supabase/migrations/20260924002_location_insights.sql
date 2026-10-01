-- Cached AI reputation insights per Google location (quota-safe).
create table if not exists public.grm_location_insights (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.grm_workspaces(id) on delete cascade,
  location_id     uuid        not null references public.grm_google_locations(id) on delete cascade,
  summary         text        not null,
  sentiment_label text        not null check (sentiment_label in ('positive', 'mixed', 'negative', 'neutral')),
  themes          jsonb       not null default '[]'::jsonb,
  highlights      jsonb       not null default '[]'::jsonb,
  risks           jsonb       not null default '[]'::jsonb,
  review_count    integer     not null default 0,
  avg_rating      numeric(3,2),
  source_hash     text        not null,
  ai_model        text        not null,
  prompt_version  text        not null,
  generated_at    timestamptz not null default now(),
  generated_by    uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, location_id)
);

comment on table public.grm_location_insights is
  'AI-generated reputation summaries per location. Cached by source_hash to conserve Gemini quota.';

create index if not exists grm_idx_location_insights_workspace
  on public.grm_location_insights (workspace_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_grm_location_insights_updated_at'
  ) then
    create trigger trg_grm_location_insights_updated_at
      before update on public.grm_location_insights
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_location_insights enable row level security;

drop policy if exists grm_location_insights_select on public.grm_location_insights;
create policy grm_location_insights_select
  on public.grm_location_insights for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
