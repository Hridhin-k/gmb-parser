-- Minimal parents so 20261020002_review_intelligence.sql can be applied on a throwaway database.
-- This is not a production migration.

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'grm_rls') then
    create role grm_rls nologin;
  end if;
end $$;

grant authenticated to grm_rls;

create table public.grm_workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique
);

create table public.grm_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  access_enabled boolean not null default true,
  scope_client_id uuid,
  scope_group_id uuid,
  scope_location_id uuid
);

create table public.grm_clients (
  id uuid primary key,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null
);

create table public.grm_groups (
  id uuid primary key,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid references public.grm_clients(id),
  parent_id uuid references public.grm_groups(id),
  name text not null,
  kind text not null
);

create table public.grm_google_locations (
  id uuid primary key,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid references public.grm_clients(id),
  group_id uuid
);

create table public.grm_reviews (
  id uuid primary key,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  comment text,
  sync_hash text,
  star_rating smallint not null,
  review_create_time timestamptz not null,
  google_review_name text not null,
  google_review_id text not null
);

create table public.grm_ai_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  version integer not null,
  status text not null,
  snapshot jsonb not null default '{}',
  unique (workspace_id, version)
);

create or replace function public.grm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.grm_my_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id
  from public.grm_workspace_members
  where user_id = auth.uid()
    and access_enabled;
$$;

create or replace function public.grm_can_see_location(
  p_workspace uuid,
  p_client uuid,
  p_group uuid,
  p_location uuid
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
        or m.scope_location_id = p_location
        or (m.scope_client_id is not null and m.scope_client_id = p_client)
        or (
          m.scope_group_id is not null
          and (
            m.scope_group_id = p_group
            or exists (
              select 1
              from public.grm_groups g
              where g.id = p_group
                and g.parent_id = m.scope_group_id
                and g.workspace_id = p_workspace
            )
          )
        )
      )
  );
$$;
