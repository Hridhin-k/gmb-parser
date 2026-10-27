-- Forward repair: restore base tables that later additive migrations ALTER
-- but never CREATE. Required for empty Supabase projects and for staging
-- after the push failed at 20261016004_escalations.sql.
--
-- Version 202610160035 sorts between 20261016003 and 20261016004 by the
-- CLI migration version prefix (confirmed via `supabase migration list`).
-- Do not edit historical migrations.
--
-- Compatibility:
--   - Fresh DB: creates bases, then 16004/16006/16008/19002 evolve them.
--   - Staging (applied through 16003): this version is pending and runs
--     before 16004. CREATE IF NOT EXISTS is a no-op if objects somehow exist.
--   - 20261019002_grm_groups.sql remains a no-op CREATE IF NOT EXISTS.
--
-- RLS SELECT policies for escalations/reports/alerts are created in
-- 20261016004 and 20261016006. Brands/groups match 19002 (RLS on, no
-- policies yet; service_role bypasses RLS as elsewhere).
-- Do not apply to production until reviewed.

-- ---------------------------------------------------------------------------
-- Escalations (pre-20261016004 shape)
-- Evidence: lib/types/supabase.ts; lib/services/escalations.ts inserts;
-- columns added later in 16004 / 19003 / 20010 must NOT appear here.
-- ---------------------------------------------------------------------------

create table if not exists public.grm_escalations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  review_id uuid not null references public.grm_reviews(id) on delete cascade,
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  status text not null default 'needs_human',
  theme text,
  assignee_user_id uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null,
  due_at timestamptz not null,
  resolved_at timestamptz,
  resolution_code text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.grm_escalations is
  'Complaint cases opened from review rules. Base table restored for fresh installs; later migrations add level, triggers, assignment, and ticket_no.';

create table if not exists public.grm_escalation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  escalation_id uuid not null references public.grm_escalations(id) on delete cascade,
  kind text not null,
  body text not null,
  created_at timestamptz not null default now()
);

comment on table public.grm_escalation_events is
  'Timeline entries for an escalation. actor_id and metadata are added in 20261016004.';

-- ---------------------------------------------------------------------------
-- Reports / alerts (pre-20261016006 shape)
-- Evidence: 16006 ALTER ADD lists (columns not listed here were already
-- present); UPDATE on name/channel; lib/types/supabase.ts; reporting.ts
-- inserts (post-16006 columns are added by that migration).
-- ---------------------------------------------------------------------------

create table if not exists public.grm_report_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null,
  frequency text not null,
  recipients text not null default '',
  channel text not null default 'in_app',
  scope_label text,
  include_scorecard boolean not null default true,
  include_leaderboard boolean not null default true,
  include_themes boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.grm_report_schedules is
  'Saved report schedules. Scope, delivery, and channel-array columns are added in 20261016006.';

create table if not exists public.grm_alert_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  channel text not null default 'in_app',
  scope_label text,
  notify_label text,
  created_at timestamptz not null default now()
);

comment on table public.grm_alert_rules is
  'Alert rule definitions. kind, thresholds, scope FKs, and channel arrays are added in 20261016006.';

create table if not exists public.grm_alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  rule_id uuid not null references public.grm_alert_rules(id) on delete cascade,
  summary text not null,
  fingerprint text not null,
  delivery text not null default 'recorded',
  created_at timestamptz not null default now(),
  unique (workspace_id, fingerprint)
);

comment on table public.grm_alert_events is
  'Fired alert instances. dedupe_key, location_id, evidence, and triggered_at are added in 20261016006.';

comment on column public.grm_alert_events.fingerprint is
  'Unique with the workspace. New alerts set this to the rule id plus the dedupe key.';

-- ---------------------------------------------------------------------------
-- Brands / groups (same definition as 20261019002; required before 16008/16009)
-- ---------------------------------------------------------------------------

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
