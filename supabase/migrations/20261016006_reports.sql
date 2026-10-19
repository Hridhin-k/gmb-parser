-- Extend the report and alert tables that already exist.
-- Existing alert rows stay. New columns carry the schedule, scope, and delivery detail.

alter table public.grm_report_schedules
  add column if not exists client_id uuid references public.grm_clients(id) on delete set null,
  add column if not exists group_id uuid references public.grm_location_groups(id) on delete set null,
  add column if not exists location_id uuid references public.grm_google_locations(id) on delete set null,
  add column if not exists sections text[] not null default '{scorecard,trends,leaderboard,themes}',
  add column if not exists delivery_time text not null default '09:00',
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists weekday smallint,
  add column if not exists day_of_month smallint,
  add column if not exists recipient_emails text[] not null default '{}',
  add column if not exists channels text[] not null default '{in_app}',
  add column if not exists enabled boolean not null default true,
  add column if not exists next_run_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.grm_alert_rules
  add column if not exists kind text not null default 'connection_expired',
  add column if not exists client_id uuid references public.grm_clients(id) on delete set null,
  add column if not exists group_id uuid references public.grm_location_groups(id) on delete set null,
  add column if not exists location_id uuid references public.grm_google_locations(id) on delete set null,
  add column if not exists recipient_emails text[] not null default '{}',
  add column if not exists channels text[] not null default '{in_app}',
  add column if not exists threshold integer not null default 3,
  add column if not exists window_days integer not null default 1,
  add column if not exists min_reviews integer not null default 5,
  add column if not exists drop_points numeric not null default 0.5,
  add column if not exists multiplier numeric not null default 2,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.grm_alert_rules
set
  kind = case
    when name ilike '%connection%' then 'connection_expired'
    when name ilike '%burst%' then 'review_burst'
    when name ilike '%rating%' then 'rating_drop'
    when name ilike '%legal%' or name ilike '%safety%' then 'legal_safety'
    else 'negative_reviews'
  end,
  channels = case
    when channel = 'email' then array['in_app','email']::text[]
    when channel = 'slack' then array['in_app','slack']::text[]
    when channel = 'whatsapp' then array['in_app','whatsapp']::text[]
    else array['in_app']::text[]
  end
where channels = array['in_app']::text[]
  and kind = 'connection_expired'
  and name ilike '%connection%';

alter table public.grm_alert_events
  add column if not exists dedupe_key text,
  add column if not exists location_id uuid references public.grm_google_locations(id) on delete set null,
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists triggered_at timestamptz not null default now();

create table if not exists public.grm_report_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  schedule_id uuid references public.grm_report_schedules(id) on delete set null,
  trigger text not null check (trigger in ('schedule', 'test')),
  slot timestamptz,
  status text not null check (status in ('running', 'delivered', 'failed', 'skipped')),
  attempts integer not null default 1 check (attempts >= 1),
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary text,
  snapshot jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists grm_report_runs_slot
  on public.grm_report_runs (schedule_id, slot)
  where slot is not null;

create table if not exists public.grm_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.grm_report_runs(id) on delete cascade,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  channel text not null,
  recipient text not null,
  status text not null check (status in ('recorded', 'sent', 'failed', 'unavailable')),
  detail text,
  created_at timestamptz not null default now(),
  unique (run_id, channel, recipient)
);

create table if not exists public.grm_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.grm_alert_events(id) on delete cascade,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  channel text not null,
  recipient text not null,
  status text not null check (status in ('recorded', 'sent', 'failed', 'unavailable')),
  detail text,
  created_at timestamptz not null default now(),
  unique (event_id, channel, recipient)
);

create index if not exists grm_idx_report_schedules_due
  on public.grm_report_schedules (next_run_at)
  where enabled;

create index if not exists grm_idx_alert_events_recent
  on public.grm_alert_events (workspace_id, triggered_at desc);

comment on column public.grm_report_schedules.channels is
  'in_app is stored in GRM. email, slack, and whatsapp are attempted only when that provider is configured.';

comment on column public.grm_alert_events.fingerprint is
  'Unique with the workspace. New alerts set this to the rule id plus the dedupe key.';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_report_schedules_updated_at') then
    create trigger trg_grm_report_schedules_updated_at
      before update on public.grm_report_schedules
      for each row execute function public.grm_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_alert_rules_updated_at') then
    create trigger trg_grm_alert_rules_updated_at
      before update on public.grm_alert_rules
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_report_schedules enable row level security;
alter table public.grm_report_runs enable row level security;
alter table public.grm_report_deliveries enable row level security;
alter table public.grm_alert_rules enable row level security;
alter table public.grm_alert_events enable row level security;
alter table public.grm_alert_deliveries enable row level security;

drop policy if exists grm_report_schedules_select on public.grm_report_schedules;
create policy grm_report_schedules_select on public.grm_report_schedules
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_report_runs_select on public.grm_report_runs;
create policy grm_report_runs_select on public.grm_report_runs
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_report_deliveries_select on public.grm_report_deliveries;
create policy grm_report_deliveries_select on public.grm_report_deliveries
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_alert_rules_select on public.grm_alert_rules;
create policy grm_alert_rules_select on public.grm_alert_rules
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_alert_events_select on public.grm_alert_events;
create policy grm_alert_events_select on public.grm_alert_events
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_alert_deliveries_select on public.grm_alert_deliveries;
create policy grm_alert_deliveries_select on public.grm_alert_deliveries
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

create or replace function public.grm_alert_location_window(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      l.id as location_id,
      l.location_title,
      count(r.id)::int as reviews,
      coalesce(sum(r.star_rating), 0)::numeric as rating_sum,
      count(r.id) filter (where r.star_rating <= 3)::int as low_stars
    from public.grm_google_locations l
    left join public.grm_reviews r
      on r.location_id = l.id
     and r.workspace_id = p_workspace_id
     and r.review_create_time >= p_start
     and r.review_create_time < p_end
    where l.workspace_id = p_workspace_id
      and (p_client_id is null or l.client_id = p_client_id)
      and (p_group_id is null or l.group_id = p_group_id)
      and (p_location_id is null or l.id = p_location_id)
    group by l.id, l.location_title
  ) x;
$$;

create or replace function public.grm_alert_keyword_reviews(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_keywords text[]
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      r.id as review_id,
      r.location_id,
      l.location_title,
      r.star_rating,
      r.comment,
      r.review_create_time
    from public.grm_reviews r
    join public.grm_google_locations l on l.id = r.location_id
    where r.workspace_id = p_workspace_id
      and r.comment is not null
      and r.review_create_time >= p_start
      and r.review_create_time < p_end
      and (p_client_id is null or l.client_id = p_client_id)
      and (p_group_id is null or l.group_id = p_group_id)
      and (p_location_id is null or l.id = p_location_id)
      and exists (
        select 1
        from unnest(coalesce(p_keywords, array[]::text[])) as keyword
        where char_length(keyword) >= 3
          and r.comment ilike '%' || replace(keyword, '%', '') || '%'
      )
    order by r.review_create_time desc
    limit 200
  ) x;
$$;

revoke all on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  to service_role;

revoke all on function public.grm_alert_keyword_reviews(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.grm_alert_keyword_reviews(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text[])
  to service_role;
