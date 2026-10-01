-- =============================================================================
-- GRM: Google Review Management — Complete Schema
-- All tables use the grm_ prefix to avoid collisions with the existing
-- marketplace schema on this shared Supabase project.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

create type grm_member_role          as enum ('owner', 'admin', 'member');
create type grm_connection_status    as enum ('active', 'expired', 'revoked');
create type grm_reply_status         as enum ('none', 'draft', 'approved', 'pending_publish', 'published', 'failed');
create type grm_ai_draft_status      as enum ('generated', 'edited', 'discarded');
create type grm_reply_source         as enum ('ai', 'manual');
create type grm_reply_pub_status     as enum ('draft', 'approved', 'pending_publish', 'published', 'failed');

-- ---------------------------------------------------------------------------
-- WORKSPACES  (analogous to "organizations" in the GRM domain)
-- Using "workspace" to avoid collision with the existing organizations table.
-- ---------------------------------------------------------------------------

create table public.grm_workspaces (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null check (char_length(name) >= 1 and char_length(name) <= 255),
  slug         text        not null unique
                             check (slug ~ '^[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.grm_workspaces is
  'Top-level tenant unit. Each workspace is an isolated GRM customer.';

-- ---------------------------------------------------------------------------
-- WORKSPACE MEMBERS
-- ---------------------------------------------------------------------------

create table public.grm_workspace_members (
  id             uuid              primary key default gen_random_uuid(),
  workspace_id   uuid              not null references public.grm_workspaces(id) on delete cascade,
  user_id        uuid              not null references auth.users(id) on delete cascade,
  role           grm_member_role   not null default 'member',
  invited_by     uuid              references auth.users(id) on delete set null,
  joined_at      timestamptz       not null default now(),
  created_at     timestamptz       not null default now(),
  unique (workspace_id, user_id)
);

comment on table public.grm_workspace_members is
  'Maps auth.users into workspaces with a role. Source of truth for tenant access.';

-- ---------------------------------------------------------------------------
-- CLIENTS
-- A "client" is a business entity whose Google reviews are being managed.
-- One workspace can manage reviews for many clients.
-- ---------------------------------------------------------------------------

create table public.grm_clients (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.grm_workspaces(id) on delete cascade,
  name           text        not null check (char_length(name) >= 1 and char_length(name) <= 255),
  notes          text,
  is_active      boolean     not null default true,
  created_by     uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.grm_clients is
  'Business entity whose Google reviews the workspace is managing.';

-- ---------------------------------------------------------------------------
-- GOOGLE CONNECTIONS
-- Represents a single OAuth 2.0 authorization grant.
-- Tokens are stored encrypted — the raw refresh token must NEVER be readable
-- by RLS-scoped queries. All token access happens via service-role server code.
-- ---------------------------------------------------------------------------

create table public.grm_google_connections (
  id                       uuid                  primary key default gen_random_uuid(),
  workspace_id             uuid                  not null references public.grm_workspaces(id) on delete cascade,
  authorized_by_user_id    uuid                  not null references auth.users(id) on delete cascade,
  google_email             text                  not null,
  -- Tokens are AES-256-GCM encrypted server-side before storage.
  -- Column prefix "_enc" signals this is never decrypted client-side.
  access_token_enc         text                  not null,
  refresh_token_enc        text                  not null,
  token_expires_at         timestamptz           not null,
  scopes                   text[]                not null default '{}',
  status                   grm_connection_status not null default 'active',
  last_refreshed_at        timestamptz,
  created_at               timestamptz           not null default now(),
  updated_at               timestamptz           not null default now(),
  -- One Google account per workspace (same email can't be connected twice)
  unique (workspace_id, google_email)
);

comment on table public.grm_google_connections is
  'OAuth 2.0 connection to a Google account. Tokens are encrypted at rest.';

comment on column public.grm_google_connections.access_token_enc is
  'AES-256-GCM encrypted access token. Never expose via RLS select policies.';

comment on column public.grm_google_connections.refresh_token_enc is
  'AES-256-GCM encrypted refresh token. Never expose via RLS select policies.';

-- ---------------------------------------------------------------------------
-- GOOGLE ACCOUNTS
-- A Google Business Profile account (mybusinessaccountmanagement/v1/accounts).
-- One OAuth connection may grant access to multiple GBP accounts.
-- ---------------------------------------------------------------------------

create table public.grm_google_accounts (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references public.grm_workspaces(id) on delete cascade,
  connection_id     uuid        not null references public.grm_google_connections(id) on delete cascade,
  -- The resource name returned by Google: "accounts/{accountId}"
  google_account_name   text    not null,
  account_display_name  text    not null,
  account_type          text    not null,
  verification_state    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, google_account_name)
);

comment on table public.grm_google_accounts is
  'Google Business Profile account, discovered via the Account Management API.';

comment on column public.grm_google_accounts.google_account_name is
  'Google resource name, e.g. "accounts/123456789". Used as external identifier.';

-- ---------------------------------------------------------------------------
-- GOOGLE LOCATIONS
-- An individual Google Business Profile location within an account.
-- A client can have many locations.
-- ---------------------------------------------------------------------------

create table public.grm_google_locations (
  id                    uuid        primary key default gen_random_uuid(),
  workspace_id          uuid        not null references public.grm_workspaces(id) on delete cascade,
  -- Nullable: null = discovered from Google but not yet assigned to a client
  client_id             uuid        references public.grm_clients(id) on delete restrict,
  google_account_id     uuid        not null references public.grm_google_accounts(id) on delete cascade,
  -- The resource name returned by Google: "accounts/{accountId}/locations/{locationId}"
  google_location_name  text        not null,
  location_title        text        not null,
  store_code            text,
  address_formatted     text,
  primary_phone         text,
  website_uri           text,
  place_id              text,
  -- Sync tracking
  is_active             boolean     not null default true,
  last_synced_at        timestamptz,
  sync_cursor           text,       -- nextPageToken from last successful sync
  total_review_count    integer     check (total_review_count >= 0),
  average_rating        numeric(3,2) check (average_rating >= 0 and average_rating <= 5),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Prevent duplicate locations within a workspace
  unique (workspace_id, google_location_name)
);

comment on table public.grm_google_locations is
  'Google Business Profile location linked to a client. Reviews are synced per location.';

comment on column public.grm_google_locations.google_location_name is
  'Google resource name, e.g. "accounts/123/locations/456". External identifier.';

comment on column public.grm_google_locations.sync_cursor is
  'Stores nextPageToken from last sync for resumable pagination.';

-- ---------------------------------------------------------------------------
-- REVIEWS
-- Local copy of a Google review. Idempotent sync via upsert on
-- (workspace_id, google_review_name).
-- ---------------------------------------------------------------------------

create table public.grm_reviews (
  id                      uuid        primary key default gen_random_uuid(),
  workspace_id            uuid        not null references public.grm_workspaces(id) on delete cascade,
  location_id             uuid        not null references public.grm_google_locations(id) on delete cascade,
  -- Google resource name: "accounts/{a}/locations/{l}/reviews/{reviewId}"
  google_review_name      text        not null,
  google_review_id        text        not null,
  -- Reviewer
  reviewer_display_name   text        not null default '',
  reviewer_profile_url    text,
  reviewer_is_anonymous   boolean     not null default false,
  -- Review content
  star_rating             smallint    not null check (star_rating between 1 and 5),
  comment                 text,       -- null when review has no comment (rating-only)
  -- Timestamps from Google (stored as returned, in UTC)
  review_create_time      timestamptz not null,
  review_update_time      timestamptz,
  -- Google's existing reply (may exist before GRM managed it)
  google_reply_comment    text,
  google_reply_update_time timestamptz,
  -- Review URL (if available from API metadata)
  review_url              text,
  -- Application reply state
  reply_status            grm_reply_status not null default 'none',
  -- Sync metadata
  first_synced_at         timestamptz not null default now(),
  last_synced_at          timestamptz not null default now(),
  sync_hash               text,       -- hash of raw Google payload for change detection
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Idempotency: one local row per Google review per workspace
  unique (workspace_id, google_review_name)
);

comment on table public.grm_reviews is
  'Local copy of a Google Business Profile review. Safe to re-sync idempotently.';

comment on column public.grm_reviews.google_review_name is
  'Full Google resource name. Primary external key for idempotent upsert.';

comment on column public.grm_reviews.sync_hash is
  'SHA-256 of the raw Google review JSON. Used to detect changes without full comparison.';

comment on column public.grm_reviews.comment is
  'Null when the reviewer left a rating without a written comment.';

-- ---------------------------------------------------------------------------
-- REVIEW AI DRAFTS
-- Stores every AI-generated response candidate separately from the reply record.
-- This preserves the full generation history.
-- ---------------------------------------------------------------------------

create table public.grm_review_ai_drafts (
  id              uuid                primary key default gen_random_uuid(),
  workspace_id    uuid                not null references public.grm_workspaces(id) on delete cascade,
  review_id       uuid                not null references public.grm_reviews(id) on delete cascade,
  -- Generated content
  content         text                not null check (char_length(content) >= 1),
  -- Generation metadata
  ai_model        text                not null,
  ai_prompt_hash  text                not null, -- SHA-256 of the exact prompt used
  prompt_version  text                not null,
  generation_params jsonb             not null default '{}',
  -- Status
  status          grm_ai_draft_status not null default 'generated',
  -- If the user edited this draft before using it
  edited_content  text,
  edited_at       timestamptz,
  edited_by       uuid                references auth.users(id) on delete set null,
  -- Which user triggered generation
  generated_by    uuid                not null references auth.users(id) on delete restrict,
  created_at      timestamptz         not null default now(),
  updated_at      timestamptz         not null default now()
);

comment on table public.grm_review_ai_drafts is
  'AI-generated reply candidates. Full generation history is preserved.';

-- ---------------------------------------------------------------------------
-- REVIEW REPLIES
-- Tracks the lifecycle of a reply from draft through publication.
-- Exactly one active reply per review (enforced via partial unique index).
-- ---------------------------------------------------------------------------

create table public.grm_review_replies (
  id                uuid                  primary key default gen_random_uuid(),
  workspace_id      uuid                  not null references public.grm_workspaces(id) on delete cascade,
  review_id         uuid                  not null references public.grm_reviews(id) on delete cascade,
  -- Optional link to the AI draft this reply was based on
  ai_draft_id       uuid                  references public.grm_review_ai_drafts(id) on delete set null,
  -- The content to publish (final approved text)
  content           text                  not null check (char_length(content) >= 1),
  source            grm_reply_source      not null,
  status            grm_reply_pub_status  not null default 'draft',
  -- Approval
  approved_at       timestamptz,
  approved_by       uuid                  references auth.users(id) on delete set null,
  -- Publication
  published_at      timestamptz,
  published_by      uuid                  references auth.users(id) on delete set null,
  -- Failure tracking
  last_error        text,
  failure_count     smallint              not null default 0 check (failure_count >= 0),
  -- Authorship
  created_by        uuid                  not null references auth.users(id) on delete restrict,
  created_at        timestamptz           not null default now(),
  updated_at        timestamptz           not null default now()
);

comment on table public.grm_review_replies is
  'Reply lifecycle for a review: draft → approved → pending_publish → published.';

-- Only one non-failed/non-discarded reply per review at a time
create unique index grm_review_replies_one_active
  on public.grm_review_replies (review_id)
  where status in ('draft', 'approved', 'pending_publish', 'published');

-- ---------------------------------------------------------------------------
-- AUDIT LOGS
-- Immutable append-only event log. No update or delete policies.
-- ---------------------------------------------------------------------------

create table public.grm_audit_logs (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.grm_workspaces(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete restrict,
  action         text        not null check (char_length(action) >= 1),
  entity_type    text        not null check (char_length(entity_type) >= 1),
  entity_id      text,
  metadata       jsonb       not null default '{}',
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

comment on table public.grm_audit_logs is
  'Immutable audit trail. No UPDATE or DELETE RLS policies are defined.';

-- ---------------------------------------------------------------------------
-- UPDATED_AT TRIGGER
-- ---------------------------------------------------------------------------

create or replace function public.grm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.grm_set_updated_at() is
  'Automatically stamps updated_at on every UPDATE.';

create trigger trg_grm_workspaces_updated_at
  before update on public.grm_workspaces
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_clients_updated_at
  before update on public.grm_clients
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_google_connections_updated_at
  before update on public.grm_google_connections
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_google_accounts_updated_at
  before update on public.grm_google_accounts
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_google_locations_updated_at
  before update on public.grm_google_locations
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_reviews_updated_at
  before update on public.grm_reviews
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_review_ai_drafts_updated_at
  before update on public.grm_review_ai_drafts
  for each row execute function public.grm_set_updated_at();

create trigger trg_grm_review_replies_updated_at
  before update on public.grm_review_replies
  for each row execute function public.grm_set_updated_at();

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

-- Workspace membership lookups (hot path: every auth check)
create index grm_idx_ws_members_user_id
  on public.grm_workspace_members (user_id);

create index grm_idx_ws_members_workspace_id
  on public.grm_workspace_members (workspace_id);

-- Clients
create index grm_idx_clients_workspace
  on public.grm_clients (workspace_id)
  where is_active = true;

-- Google connections
create index grm_idx_connections_workspace
  on public.grm_google_connections (workspace_id);

create index grm_idx_connections_status
  on public.grm_google_connections (workspace_id, status);

-- Google accounts
create index grm_idx_accounts_workspace
  on public.grm_google_accounts (workspace_id);

create index grm_idx_accounts_connection
  on public.grm_google_accounts (connection_id);

-- Google locations
create index grm_idx_locations_workspace
  on public.grm_google_locations (workspace_id);

create index grm_idx_locations_client
  on public.grm_google_locations (client_id);

create index grm_idx_locations_active
  on public.grm_google_locations (workspace_id)
  where is_active = true;

-- Locations pending sync (never synced or last sync was old)
create index grm_idx_locations_sync_state
  on public.grm_google_locations (workspace_id, last_synced_at nulls first);

-- Reviews — core query patterns
create index grm_idx_reviews_location
  on public.grm_reviews (location_id);

create index grm_idx_reviews_workspace
  on public.grm_reviews (workspace_id);

-- Reviews without a reply (unanswered)
create index grm_idx_reviews_unanswered
  on public.grm_reviews (workspace_id, review_create_time desc)
  where reply_status = 'none';

-- Reviews by star rating for filtering
create index grm_idx_reviews_rating
  on public.grm_reviews (workspace_id, star_rating, review_create_time desc);

-- Reviews by creation time (most recent first — default sort)
create index grm_idx_reviews_create_time
  on public.grm_reviews (workspace_id, review_create_time desc);

-- Reviews by reply_status for pipeline views
create index grm_idx_reviews_reply_status
  on public.grm_reviews (workspace_id, reply_status);

-- AI drafts
create index grm_idx_ai_drafts_review
  on public.grm_review_ai_drafts (review_id);

create index grm_idx_ai_drafts_workspace
  on public.grm_review_ai_drafts (workspace_id);

-- Replies
create index grm_idx_replies_review
  on public.grm_review_replies (review_id);

create index grm_idx_replies_workspace_status
  on public.grm_review_replies (workspace_id, status);

-- Audit logs — time-sorted per workspace
create index grm_idx_audit_workspace_time
  on public.grm_audit_logs (workspace_id, created_at desc);

-- Audit logs — entity lookups
create index grm_idx_audit_entity
  on public.grm_audit_logs (entity_type, entity_id);

-- Audit logs — user activity
create index grm_idx_audit_user
  on public.grm_audit_logs (user_id, created_at desc);
