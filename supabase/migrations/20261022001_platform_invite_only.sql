-- =============================================================================
-- Platform invite-only tenancy + super-admin tenant lifecycle
-- Reverse: drop table public.grm_platform_invites;
--          alter table public.grm_workspaces drop column status, drop column suspended_at, drop column deleted_at;
-- Existing workspaces default to 'active' (grandfathered).
-- =============================================================================

alter table public.grm_workspaces
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended', 'deleted')),
  add column if not exists suspended_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists grm_workspaces_status
  on public.grm_workspaces (status);

create table if not exists public.grm_platform_invites (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (
                     email = lower(email)
                     and char_length(email) >= 3
                     and char_length(email) <= 320
                     and email like '%@%'
                   ),
  invited_by       uuid references auth.users(id) on delete set null,
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'revoked', 'expired')),
  workspace_id     uuid references public.grm_workspaces(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  note             text check (note is null or char_length(note) <= 500),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.grm_platform_invites is
  'Platform (super-admin) invite for one tenant owner email. One invite creates one workspace when that exact email signs in with Google and names the tenant. No email is sent by this migration.';

-- One live invite per email; an accepted email cannot be re-invited to create a second tenant.
create unique index if not exists grm_platform_invites_one_pending_email
  on public.grm_platform_invites (email)
  where status = 'pending';

create unique index if not exists grm_platform_invites_one_accepted_email
  on public.grm_platform_invites (email)
  where status = 'accepted';

create index if not exists grm_platform_invites_pending_email
  on public.grm_platform_invites (email)
  where status = 'pending';

alter table public.grm_platform_invites enable row level security;
-- No select/insert policies: only the service role (server code, super-admin gated) touches this table.

drop trigger if exists trg_grm_platform_invites_updated_at on public.grm_platform_invites;
create trigger trg_grm_platform_invites_updated_at
  before update on public.grm_platform_invites
  for each row execute function public.grm_set_updated_at();
