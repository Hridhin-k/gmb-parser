-- Cluster identity, evidence, and transition history.
-- Reverse: drop table public.grm_cluster_events; drop the added columns on public.grm_semantic_clusters.
-- Do not drop extensions.vector.

alter table public.grm_semantic_clusters
  add column if not exists topic_key text not null default '',
  add column if not exists title text not null default '',
  add column if not exists confidence numeric(4,3),
  add column if not exists quality text not null default 'noise'
    check (quality in ('established', 'emerging', 'watch', 'noise', 'broad')),
  add column if not exists stats jsonb not null default '{}'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists signals jsonb not null default '[]'::jsonb;

comment on table public.grm_semantic_clusters is
  'One stable key per recurring issue inside a workspace and topic set. Membership changes update this row. Merge and split are recorded in grm_cluster_events and do not delete the old key.';

create table if not exists public.grm_cluster_events (
  id                   uuid        primary key default gen_random_uuid(),
  workspace_id         uuid        not null references public.grm_workspaces(id) on delete cascade,
  cluster_key          text        not null,
  event                text        not null check (event in ('created', 'joined', 'merged', 'split', 'retired')),
  related_cluster_key  text,
  review_ids           uuid[]      not null default '{}',
  detail               jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists grm_idx_cluster_events_workspace
  on public.grm_cluster_events (workspace_id, cluster_key, created_at);

alter table public.grm_cluster_events enable row level security;

drop policy if exists grm_cluster_events_select on public.grm_cluster_events;
create policy grm_cluster_events_select on public.grm_cluster_events
  for select using (
    exists (
      select 1
      from public.grm_workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id = grm_cluster_events.workspace_id
        and m.access_enabled
        and m.scope_client_id is null
        and m.scope_group_id is null
        and m.scope_location_id is null
    )
    or exists (
      select 1
      from public.grm_semantic_clusters c
      join public.grm_cluster_members cm on cm.cluster_id = c.id
      join public.grm_reviews r on r.id = cm.review_id
      join public.grm_google_locations l on l.id = r.location_id
      where c.workspace_id = grm_cluster_events.workspace_id
        and c.cluster_key = grm_cluster_events.cluster_key
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

insert into public.grm_topic_aliases (topic_id, workspace_id, alias)
select t.id, null, seed.alias
from (
  values
    ('cleanliness', 'cleaning'),
    ('cleanliness', 'unhygienic'),
    ('fitting_room', 'changing area'),
    ('fitting_room', 'fitting rooms')
) as seed(code, alias)
join public.grm_topics t
  on t.workspace_id is null
 and t.taxonomy_version = 'taxonomy-v2'
 and t.kind = 'topic'
 and t.code = seed.code
where not exists (
  select 1
  from public.grm_topic_aliases existing
  where existing.topic_id = t.id
    and existing.alias = seed.alias
);
