-- =============================================================================
-- GRM: Row Level Security Policies
-- =============================================================================
-- Security model:
--   - All writes (INSERT/UPDATE) happen via service-role (server-only admin client).
--   - RLS policies only need to secure SELECT for the authenticated client.
--   - grm_audit_logs: SELECT only, NO INSERT/UPDATE/DELETE via RLS.
--   - grm_google_connections: token columns are always excluded from client queries
--     (enforced in application code, not in RLS — RLS cannot hide columns).
--     Access is further restricted: only the authorizing user's workspace.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on all GRM tables
-- ---------------------------------------------------------------------------

alter table public.grm_workspaces          enable row level security;
alter table public.grm_workspace_members   enable row level security;
alter table public.grm_clients             enable row level security;
alter table public.grm_google_connections  enable row level security;
alter table public.grm_google_accounts     enable row level security;
alter table public.grm_google_locations    enable row level security;
alter table public.grm_reviews             enable row level security;
alter table public.grm_review_ai_drafts    enable row level security;
alter table public.grm_review_replies      enable row level security;
alter table public.grm_audit_logs          enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: returns set of workspace IDs the current user belongs to.
-- security definer so it runs with the function owner's privileges, avoiding
-- infinite recursion on grm_workspace_members.
-- ---------------------------------------------------------------------------

create or replace function public.grm_my_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id
  from public.grm_workspace_members
  where user_id = auth.uid();
$$;

comment on function public.grm_my_workspace_ids() is
  'Returns all workspace IDs the current user is a member of. Used in RLS policies.';

-- ---------------------------------------------------------------------------
-- grm_workspaces
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view their workspace"
  on public.grm_workspaces
  for select
  using (id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_workspace_members
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view membership roster"
  on public.grm_workspace_members
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_clients
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view clients"
  on public.grm_clients
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_google_connections
-- Token columns (access_token_enc, refresh_token_enc) are readable via this
-- policy but MUST be excluded in every application SELECT — the server-side
-- admin client is used for all token access. Never select token columns in
-- client-facing queries.
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view connections (no tokens)"
  on public.grm_google_connections
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_google_accounts
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view google accounts"
  on public.grm_google_accounts
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_google_locations
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view locations"
  on public.grm_google_locations
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_reviews
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view reviews"
  on public.grm_reviews
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_review_ai_drafts
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view ai drafts"
  on public.grm_review_ai_drafts
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_review_replies
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view replies"
  on public.grm_review_replies
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- grm_audit_logs — READ ONLY via RLS. All writes use service role.
-- ---------------------------------------------------------------------------

create policy "grm: workspace members can view audit logs"
  on public.grm_audit_logs
  for select
  using (workspace_id in (select grm_my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- NOTES ON WRITE SECURITY
-- ---------------------------------------------------------------------------
-- No INSERT/UPDATE/DELETE policies are defined for the authenticated role.
-- All mutations flow through server-side Next.js API routes that use the
-- Supabase admin client (service_role key).
-- This means:
--   1. No client can write to GRM tables directly.
--   2. Server code is responsible for enforcing workspace scoping before writes.
--   3. The absence of write policies is intentional — if the service role is
--      never sent to the browser, the attack surface is minimal.
