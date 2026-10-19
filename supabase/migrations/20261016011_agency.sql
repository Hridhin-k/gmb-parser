-- Agency clients, onboarding links, branding, and usage events.

alter table public.grm_clients
  add column if not exists contact_email text,
  add column if not exists website text,
  add column if not exists account_manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists brand_name text,
  add column if not exists logo_url text;

alter table public.grm_clients
  drop constraint if exists grm_clients_contact_email_check;

alter table public.grm_clients
  add constraint grm_clients_contact_email_check
  check (
    contact_email is null
    or (position('@' in contact_email) > 1 and char_length(contact_email) <= 200)
  );

alter table public.grm_clients
  drop constraint if exists grm_clients_brand_name_check;

alter table public.grm_clients
  add constraint grm_clients_brand_name_check
  check (brand_name is null or char_length(brand_name) between 1 and 80);

alter table public.grm_google_connections
  add column if not exists client_id uuid references public.grm_clients(id) on delete set null;

alter table public.grm_review_replies
  add column if not exists client_approval text not null default 'none';

alter table public.grm_review_replies
  drop constraint if exists grm_review_replies_client_approval_check;

alter table public.grm_review_replies
  add constraint grm_review_replies_client_approval_check
  check (client_approval in ('none', 'requested', 'approved'));

create table if not exists public.grm_client_onboarding (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid not null references public.grm_clients(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.grm_agency_branding (
  workspace_id uuid primary key references public.grm_workspaces(id) on delete cascade,
  logo_url text,
  hide_product_name boolean not null default false,
  custom_domain text,
  domain_token text,
  domain_verified_at timestamptz,
  sender_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.grm_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  client_id uuid references public.grm_clients(id) on delete set null,
  kind text not null check (kind in ('reply_published', 'client_connected', 'client_created')),
  source_id text not null,
  occurred_at timestamptz not null default now(),
  unique (workspace_id, kind, source_id)
);

alter table public.grm_client_onboarding enable row level security;
alter table public.grm_agency_branding enable row level security;
alter table public.grm_usage_events enable row level security;
