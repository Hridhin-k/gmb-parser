-- =============================================================================
-- Super-admin suite: plans/limits/flags on tenants, blocked users,
-- announcements + platform settings, access requests.
-- Reverse: drop tables grm_access_requests, grm_platform_announcements,
-- grm_platform_settings, grm_platform_blocked_users; drop the added
-- grm_workspaces columns.
-- =============================================================================

alter table public.grm_workspaces
  add column if not exists plan text not null default 'trial'
    check (plan in ('trial', 'starter', 'growth', 'enterprise', 'lifetime')),
  add column if not exists plan_expires_at timestamptz,
  add column if not exists ai_monthly_budget_usd numeric(10, 2)
    check (ai_monthly_budget_usd is null or ai_monthly_budget_usd >= 0),
  add column if not exists max_locations integer
    check (max_locations is null or max_locations > 0),
  add column if not exists max_members integer
    check (max_members is null or max_members > 0),
  add column if not exists admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

create table if not exists public.grm_platform_blocked_users (
  email      text primary key check (email = lower(email) and email like '%@%'),
  user_id    uuid references auth.users(id) on delete set null,
  reason     text check (reason is null or char_length(reason) <= 500),
  blocked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.grm_platform_blocked_users is 'Platform-wide login block by email. Checked at the tenant gate; tenant memberships are kept.';
alter table public.grm_platform_blocked_users enable row level security;

create table if not exists public.grm_platform_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.grm_platform_settings is 'Platform key/value settings, e.g. maintenance mode. Service-role only.';
alter table public.grm_platform_settings enable row level security;

create table if not exists public.grm_platform_announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 200),
  body       text not null check (char_length(body) between 1 and 2000),
  tone       text not null default 'info' check (tone in ('info', 'warning')),
  active     boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.grm_platform_announcements enable row level security;

create table if not exists public.grm_access_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(email) and email like '%@%'),
  user_id    uuid references auth.users(id) on delete set null,
  company    text check (company is null or char_length(company) <= 255),
  message    text check (message is null or char_length(message) <= 1000),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.grm_access_requests is 'Request-access submissions from the invite-only gate. Approving creates a platform tenant invite.';
alter table public.grm_access_requests enable row level security;

create unique index if not exists grm_access_requests_one_pending_email
  on public.grm_access_requests (email) where status = 'pending';
create index if not exists grm_access_requests_pending
  on public.grm_access_requests (created_at desc) where status = 'pending';
