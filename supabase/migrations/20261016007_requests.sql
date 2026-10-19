-- Review-request campaigns, customers, QR codes, and delivery records.
-- Additive. Does not change existing tables.

create table if not exists public.grm_request_policies (
  workspace_id uuid primary key references public.grm_workspaces(id) on delete cascade,
  cooldown_days integer not null default 90 check (cooldown_days between 1 and 365),
  updated_at timestamptz not null default now()
);

create table if not exists public.grm_request_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'qr')),
  language text not null default 'en',
  template text not null default '',
  reminder_enabled boolean not null default false,
  reminder_after_days integer not null default 3 check (reminder_after_days between 1 and 30),
  status text not null default 'draft' check (status in ('draft', 'ready', 'sending', 'sent', 'failed')),
  source text not null default 'csv' check (source in ('csv', 'qr')),
  preview_eligible integer not null default 0,
  preview_suppressed integer not null default 0,
  preview_opted_out integer not null default 0,
  preview_missing_contact integer not null default 0,
  preview_unknown_store integer not null default 0,
  preview_duplicates integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.grm_request_campaign_locations (
  campaign_id uuid not null references public.grm_request_campaigns(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  primary key (campaign_id, location_id)
);

create table if not exists public.grm_request_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null default '',
  email text,
  phone text,
  phone_key text,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  dedupe_key text not null,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table if not exists public.grm_request_recipients (
  campaign_id uuid not null references public.grm_request_campaigns(id) on delete cascade,
  customer_id uuid not null references public.grm_request_customers(id) on delete cascade,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  decision text not null check (decision in ('eligible', 'suppressed', 'opted_out')),
  primary key (campaign_id, customer_id)
);

create table if not exists public.grm_request_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  campaign_id uuid references public.grm_request_campaigns(id) on delete set null,
  customer_id uuid references public.grm_request_customers(id) on delete set null,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  channel text not null,
  token text not null unique,
  status text not null check (status in ('suppressed', 'opted_out', 'unavailable', 'queued', 'accepted', 'failed', 'delivered')),
  is_test boolean not null default false,
  is_reminder boolean not null default false,
  reminder_of uuid references public.grm_request_messages(id) on delete set null,
  attempts integer not null default 0,
  retryable boolean not null default false,
  provider_ref text,
  error text,
  queued_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  google_clicked_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists grm_request_messages_once
  on public.grm_request_messages (campaign_id, customer_id)
  where is_reminder = false and is_test = false and customer_id is not null;

create unique index if not exists grm_request_messages_one_reminder
  on public.grm_request_messages (reminder_of)
  where reminder_of is not null;

create index if not exists grm_idx_request_messages_retry
  on public.grm_request_messages (next_attempt_at)
  where status in ('queued', 'failed') and retryable = true;

create table if not exists public.grm_request_qr (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  token text not null unique,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  unique (workspace_id, location_id)
);

create table if not exists public.grm_request_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  message_id uuid references public.grm_request_messages(id) on delete cascade,
  qr_id uuid references public.grm_request_qr(id) on delete cascade,
  kind text not null check (kind in ('accepted', 'delivered', 'opened', 'clicked', 'google_click', 'feedback', 'failed', 'opted_out', 'scan')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists grm_idx_request_events_qr
  on public.grm_request_events (qr_id, kind);

create table if not exists public.grm_request_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  location_id uuid references public.grm_google_locations(id) on delete set null,
  message_id uuid references public.grm_request_messages(id) on delete set null,
  qr_id uuid references public.grm_request_qr(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists grm_request_feedback_one_message
  on public.grm_request_feedback (message_id)
  where message_id is not null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_request_policies_updated_at') then
    create trigger trg_grm_request_policies_updated_at
      before update on public.grm_request_policies
      for each row execute function public.grm_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_request_campaigns_updated_at') then
    create trigger trg_grm_request_campaigns_updated_at
      before update on public.grm_request_campaigns
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_request_policies enable row level security;
alter table public.grm_request_campaigns enable row level security;
alter table public.grm_request_campaign_locations enable row level security;
alter table public.grm_request_customers enable row level security;
alter table public.grm_request_recipients enable row level security;
alter table public.grm_request_messages enable row level security;
alter table public.grm_request_qr enable row level security;
alter table public.grm_request_events enable row level security;
alter table public.grm_request_feedback enable row level security;

drop policy if exists grm_request_policies_select on public.grm_request_policies;
create policy grm_request_policies_select on public.grm_request_policies
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_campaigns_select on public.grm_request_campaigns;
create policy grm_request_campaigns_select on public.grm_request_campaigns
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_campaign_locations_select on public.grm_request_campaign_locations;
create policy grm_request_campaign_locations_select on public.grm_request_campaign_locations
  for select using (
    campaign_id in (
      select id from public.grm_request_campaigns
      where workspace_id in (select public.grm_my_workspace_ids())
    )
  );

drop policy if exists grm_request_customers_select on public.grm_request_customers;
create policy grm_request_customers_select on public.grm_request_customers
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_recipients_select on public.grm_request_recipients;
create policy grm_request_recipients_select on public.grm_request_recipients
  for select using (
    campaign_id in (
      select id from public.grm_request_campaigns
      where workspace_id in (select public.grm_my_workspace_ids())
    )
  );

drop policy if exists grm_request_messages_select on public.grm_request_messages;
create policy grm_request_messages_select on public.grm_request_messages
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_qr_select on public.grm_request_qr;
create policy grm_request_qr_select on public.grm_request_qr
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_events_select on public.grm_request_events;
create policy grm_request_events_select on public.grm_request_events
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_request_feedback_select on public.grm_request_feedback;
create policy grm_request_feedback_select on public.grm_request_feedback
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

create or replace function public.grm_request_board(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sent', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and accepted_at is not null),
    'delivered', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and delivered_at is not null),
    'opened', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and opened_at is not null),
    'message_clicks', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and clicked_at is not null),
    'scans', (select count(*) from public.grm_request_events where workspace_id = p_workspace and kind = 'scan'),
    'feedback', (select count(*) from public.grm_request_feedback where workspace_id = p_workspace),
    'opted_out', (select count(*) from public.grm_request_customers where workspace_id = p_workspace and opted_out_at is not null),
    'campaigns', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
      from (
        select
          camp.id,
          camp.name,
          camp.channel,
          camp.status,
          camp.language,
          camp.source,
          camp.created_at,
          camp.sent_at,
          camp.reminder_enabled,
          camp.preview_eligible,
          camp.preview_suppressed,
          camp.preview_opted_out,
          camp.preview_missing_contact,
          camp.preview_unknown_store,
          camp.preview_duplicates,
          (select count(*) from public.grm_request_campaign_locations cl where cl.campaign_id = camp.id) as locations,
          (select coalesce(jsonb_agg(cl.location_id), '[]'::jsonb) from public.grm_request_campaign_locations cl where cl.campaign_id = camp.id) as location_ids,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.accepted_at is not null) as sent,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.delivered_at is not null) as delivered,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.opened_at is not null) as opened,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'failed') as failed,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'queued') as queued,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'unavailable') as unavailable,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'suppressed') as suppressed,
          (select m.error from public.grm_request_messages m where m.campaign_id = camp.id and m.error is not null order by m.created_at desc limit 1) as last_error
        from public.grm_request_campaigns camp
        where camp.workspace_id = p_workspace
      ) c
    ),
    'qr', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
      from (
        select
          qr.location_id,
          qr.token,
          qr.language,
          (select count(*) from public.grm_request_events e where e.qr_id = qr.id and e.kind = 'scan') as scans,
          (select count(*) from public.grm_request_feedback f where f.qr_id = qr.id) as feedback
        from public.grm_request_qr qr
        where qr.workspace_id = p_workspace
      ) q
    )
  );
$$;

revoke all on function public.grm_request_board(uuid) from public;
revoke all on function public.grm_request_board(uuid) from anon;
revoke all on function public.grm_request_board(uuid) from authenticated;
grant execute on function public.grm_request_board(uuid) to service_role;
