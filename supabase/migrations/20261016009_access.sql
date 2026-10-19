-- Team roles, scope, and access flags. Existing owner, admin, and member rows stay valid.

alter type public.grm_member_role add value if not exists 'org_admin';
alter type public.grm_member_role add value if not exists 'brand_manager';
alter type public.grm_member_role add value if not exists 'group_manager';
alter type public.grm_member_role add value if not exists 'store_manager';
alter type public.grm_member_role add value if not exists 'agent';
alter type public.grm_member_role add value if not exists 'auditor';

alter table public.grm_workspace_members
  add column if not exists access_enabled boolean not null default true,
  add column if not exists scope_client_id uuid references public.grm_clients(id) on delete set null,
  add column if not exists scope_group_id uuid references public.grm_groups(id) on delete set null,
  add column if not exists scope_location_id uuid references public.grm_google_locations(id) on delete set null,
  add column if not exists alert_email boolean not null default false,
  add column if not exists alert_in_app boolean not null default true;

alter table public.grm_workspace_invites
  add column if not exists scope_client_id uuid references public.grm_clients(id) on delete set null,
  add column if not exists scope_group_id uuid references public.grm_groups(id) on delete set null,
  add column if not exists scope_location_id uuid references public.grm_google_locations(id) on delete set null;

alter table public.grm_workspace_members
  drop constraint if exists grm_members_one_scope;
alter table public.grm_workspace_members
  add constraint grm_members_one_scope check (
    (case when scope_client_id is null then 0 else 1 end)
    + (case when scope_group_id is null then 0 else 1 end)
    + (case when scope_location_id is null then 0 else 1 end) <= 1
  );

alter table public.grm_workspace_invites
  drop constraint if exists grm_invites_one_scope;
alter table public.grm_workspace_invites
  add constraint grm_invites_one_scope check (
    (case when scope_client_id is null then 0 else 1 end)
    + (case when scope_group_id is null then 0 else 1 end)
    + (case when scope_location_id is null then 0 else 1 end) <= 1
  );

alter table public.grm_workspace_invites
  drop constraint if exists grm_workspace_invites_role_check;
alter table public.grm_workspace_invites
  add constraint grm_workspace_invites_role_check check (role <> 'owner');

create or replace function public.grm_my_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id
  from public.grm_workspace_members
  where user_id = auth.uid()
    and access_enabled;
$$;

create or replace function public.grm_can_see_location(
  p_workspace uuid,
  p_client uuid,
  p_group uuid,
  p_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grm_workspace_members m
    where m.user_id = auth.uid()
      and m.workspace_id = p_workspace
      and m.access_enabled
      and (
        (m.scope_client_id is null and m.scope_group_id is null and m.scope_location_id is null)
        or m.scope_location_id = p_location
        or (m.scope_client_id is not null and m.scope_client_id = p_client)
        or (
          m.scope_group_id is not null
          and (
            m.scope_group_id = p_group
            or exists (
              select 1
              from public.grm_groups g
              where g.id = p_group
                and g.parent_id = m.scope_group_id
                and g.workspace_id = p_workspace
            )
          )
        )
      )
  );
$$;

drop policy if exists "grm: workspace members can view locations" on public.grm_google_locations;
create policy "grm: workspace members can view locations"
  on public.grm_google_locations
  for select
  using (public.grm_can_see_location(workspace_id, client_id, group_id, id));

drop policy if exists "grm: workspace members can view reviews" on public.grm_reviews;
create policy "grm: workspace members can view reviews"
  on public.grm_reviews
  for select
  using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.id = location_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists grm_escalations_select on public.grm_escalations;
drop policy if exists "grm: members read escalations" on public.grm_escalations;
create policy grm_escalations_select on public.grm_escalations
  for select
  using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.id = location_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

drop policy if exists "grm: workspace members can view clients" on public.grm_clients;
create policy "grm: workspace members can view clients"
  on public.grm_clients
  for select
  using (
    exists (
      select 1
      from public.grm_workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id = grm_clients.workspace_id
        and m.access_enabled
        and (
          (m.scope_client_id is null and m.scope_group_id is null and m.scope_location_id is null)
          or m.scope_client_id = grm_clients.id
          or exists (
            select 1
            from public.grm_google_locations l
            where l.client_id = grm_clients.id
              and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
          )
        )
    )
  );
