-- The app stores regions and cities in grm_groups, and one brand row per organisation in grm_brands.
-- Earlier migrations reference these tables without creating them. Creating them here is a no-op when they already exist.
-- A location still has one group_id. Reviews stay on the location.

create table if not exists public.grm_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid not null references public.grm_clients(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160)
);

create unique index if not exists grm_brands_client
  on public.grm_brands (workspace_id, client_id);

create table if not exists public.grm_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid not null references public.grm_clients(id) on delete cascade,
  brand_id uuid not null references public.grm_brands(id) on delete cascade,
  parent_id uuid references public.grm_groups(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'region' check (kind in ('region', 'city')),
  sort_order integer not null default 0
);

create unique index if not exists grm_groups_name_scope
  on public.grm_groups (
    workspace_id,
    client_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index if not exists grm_idx_groups_parent on public.grm_groups (parent_id);
create index if not exists grm_idx_groups_client on public.grm_groups (client_id);

alter table public.grm_brands enable row level security;
alter table public.grm_groups enable row level security;
