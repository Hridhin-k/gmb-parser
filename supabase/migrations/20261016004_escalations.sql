-- Additive escalation columns. Existing complaint rows stay in place.
-- Timestamps are timestamptz (UTC). Due times are durations from opened_at.

create table if not exists public.grm_escalation_policies (
  workspace_id uuid primary key references public.grm_workspaces(id) on delete cascade,
  max_stars integer not null default 3 check (max_stars between 1 and 5),
  flag_profanity boolean not null default true,
  flag_legal_safety boolean not null default true,
  extra_keywords text[] not null default '{}',
  reminder_hours integer[] not null default '{2,6}',
  due_hours integer not null default 24 check (due_hours between 1 and 168),
  timezone text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now()
);

comment on table public.grm_escalation_policies is
  'Configurable complaint rules. Defaults match a 3-star threshold, reminders at 2 and 6 hours, and a 24-hour due time.';

alter table public.grm_escalations
  add column if not exists level text not null default 'store',
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists trigger_reasons text[] not null default '{recorded}',
  add column if not exists trigger_key text;

update public.grm_escalations
set trigger_key = md5(review_id::text)
where trigger_key is null;

alter table public.grm_escalations
  alter column trigger_key set not null;

do $$
begin
  alter table public.grm_escalations
    add constraint grm_escalations_level_check
    check (level in ('store', 'regional', 'leadership'));
exception
  when duplicate_object then null;
end $$;

alter table public.grm_escalation_events
  add column if not exists actor_id uuid references auth.users(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.grm_escalation_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  escalation_id uuid not null references public.grm_escalations(id) on delete cascade,
  kind text not null,
  due_at timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  unique (escalation_id, kind)
);

comment on table public.grm_escalation_reminders is
  'In-app SLA reminders. sent_at means the reminder was recorded in GRM, not that an email or message was delivered.';

create index if not exists grm_idx_escalation_reminders_due
  on public.grm_escalation_reminders (due_at)
  where sent_at is null;

create table if not exists public.grm_autoreply_pauses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  scope text not null check (scope in ('workspace', 'client', 'location')),
  client_id uuid references public.grm_clients(id) on delete cascade,
  location_id uuid references public.grm_google_locations(id) on delete cascade,
  paused_by uuid not null references auth.users(id) on delete restrict,
  paused_at timestamptz not null default now(),
  cleared_at timestamptz,
  check (
    (scope = 'workspace' and client_id is null and location_id is null)
    or (scope = 'client' and client_id is not null and location_id is null)
    or (scope = 'location' and location_id is not null and client_id is null)
  )
);

create unique index if not exists grm_autoreply_pause_workspace
  on public.grm_autoreply_pauses (workspace_id)
  where scope = 'workspace' and cleared_at is null;

create unique index if not exists grm_autoreply_pause_client
  on public.grm_autoreply_pauses (client_id)
  where scope = 'client' and cleared_at is null;

create unique index if not exists grm_autoreply_pause_location
  on public.grm_autoreply_pauses (location_id)
  where scope = 'location' and cleared_at is null;

alter table public.grm_escalation_policies enable row level security;
alter table public.grm_escalations enable row level security;
alter table public.grm_escalation_events enable row level security;
alter table public.grm_escalation_reminders enable row level security;
alter table public.grm_autoreply_pauses enable row level security;

drop policy if exists grm_escalation_policies_select on public.grm_escalation_policies;
create policy grm_escalation_policies_select on public.grm_escalation_policies
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_escalations_select on public.grm_escalations;
create policy grm_escalations_select on public.grm_escalations
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_escalation_events_select on public.grm_escalation_events;
create policy grm_escalation_events_select on public.grm_escalation_events
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_escalation_reminders_select on public.grm_escalation_reminders;
create policy grm_escalation_reminders_select on public.grm_escalation_reminders
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_autoreply_pauses_select on public.grm_autoreply_pauses;
create policy grm_autoreply_pauses_select on public.grm_autoreply_pauses
  for select using (workspace_id in (select public.grm_my_workspace_ids()));
