-- Reply tone, templates, and automation. Null scope fields inherit from the parent.

alter table public.grm_scope_settings
  drop constraint if exists grm_scope_settings_group_id_fkey;

alter table public.grm_scope_settings
  add constraint grm_scope_settings_group_id_fkey
  foreign key (group_id) references public.grm_groups(id) on delete cascade;

alter table public.grm_scope_settings
  add column if not exists tone jsonb,
  add column if not exists automation jsonb;

create table if not exists public.grm_reply_settings (
  workspace_id uuid primary key references public.grm_workspaces(id) on delete cascade,
  tone jsonb not null default '{}'::jsonb,
  automation jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.grm_reply_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 1000),
  client_id uuid references public.grm_clients(id) on delete cascade,
  group_id uuid references public.grm_groups(id) on delete cascade,
  location_id uuid references public.grm_google_locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (case when client_id is null then 0 else 1 end)
    + (case when group_id is null then 0 else 1 end)
    + (case when location_id is null then 0 else 1 end) <= 1
  )
);

alter table public.grm_reply_settings enable row level security;
alter table public.grm_reply_templates enable row level security;

drop policy if exists grm_reply_settings_select on public.grm_reply_settings;
create policy grm_reply_settings_select on public.grm_reply_settings
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_reply_templates_select on public.grm_reply_templates;
create policy grm_reply_templates_select on public.grm_reply_templates
  for select using (workspace_id in (select public.grm_my_workspace_ids()));
