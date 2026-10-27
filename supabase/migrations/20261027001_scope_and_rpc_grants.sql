-- Tenant isolation for child tables, and revoke of aggregate RPCs that
-- 20261022010 recreated without their previous REVOKE.
--
-- Problem: reviews, locations, and escalations use grm_can_see_location.
-- Analyses, observations, replies, insight reports, analysis runs, AI jobs,
-- and bulk jobs still allow every member of the workspace to read them.
-- A scoped store manager can therefore read another location's observations
-- through the Data API. CREATE OR REPLACE on grm_star_breakdown and
-- grm_agency_counts also restored default execute grants to public.
--
-- This migration does not build indexes and does not rewrite review rows.
-- The location group foreign key is retargeted to grm_groups only when every
-- existing group_id already exists there. Production already points at
-- grm_groups, so that block is a no-op. A database whose group ids still
-- point at grm_location_groups fails closed instead of orphaning rows.
--
-- Do not apply this to production until it has been reviewed. Rollback:
-- recreate the previous workspace-wide SELECT policies
--   using (workspace_id in (select public.grm_my_workspace_ids()))
-- and, only if this migration changed the group foreign key, point it back
-- at the previous table. Re-granting execute on the two RPCs to anon is not
-- required for the application; the service role is the caller.

create or replace function pg_temp.grm_drop_select_policies(p_table text)
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = p_table
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', r.policyname, p_table);
  end loop;
end;
$$;

select pg_temp.grm_drop_select_policies('grm_review_analyses');
create policy "grm: scoped read review analyses"
  on public.grm_review_analyses
  for select
  using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.id = location_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

select pg_temp.grm_drop_select_policies('grm_review_observations');
create policy "grm: scoped read review observations"
  on public.grm_review_observations
  for select
  using (
    public.grm_can_see_location(workspace_id, client_id, group_id, location_id)
  );

select pg_temp.grm_drop_select_policies('grm_review_replies');
create policy "grm: scoped read review replies"
  on public.grm_review_replies
  for select
  using (
    exists (
      select 1
      from public.grm_reviews r
      join public.grm_google_locations l on l.id = r.location_id
      where r.id = review_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
  );

select pg_temp.grm_drop_select_policies('grm_insight_reports');
create policy "grm: scoped read insight reports"
  on public.grm_insight_reports
  for select
  using (
    (
      location_id is not null
      and exists (
        select 1
        from public.grm_google_locations l
        where l.id = location_id
          and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
      )
    )
    or (
      location_id is null
      and exists (
        select 1
        from public.grm_workspace_members m
        where m.user_id = auth.uid()
          and m.workspace_id = grm_insight_reports.workspace_id
          and m.access_enabled
          and m.scope_client_id is null
          and m.scope_group_id is null
          and m.scope_location_id is null
      )
    )
  );

select pg_temp.grm_drop_select_policies('grm_analysis_runs');
create policy "grm: scoped read analysis runs"
  on public.grm_analysis_runs
  for select
  using (
    (
      location_id is not null
      and exists (
        select 1
        from public.grm_google_locations l
        where l.id = location_id
          and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
      )
    )
    or (
      location_id is null
      and exists (
        select 1
        from public.grm_workspace_members m
        where m.user_id = auth.uid()
          and m.workspace_id = grm_analysis_runs.workspace_id
          and m.access_enabled
          and m.scope_client_id is null
          and m.scope_group_id is null
          and m.scope_location_id is null
      )
    )
  );

select pg_temp.grm_drop_select_policies('grm_ai_generation_jobs');
create policy "grm: owner or scoped read ai jobs"
  on public.grm_ai_generation_jobs
  for select
  using (
    user_id = auth.uid()
    or (
      location_id is not null
      and exists (
        select 1
        from public.grm_google_locations l
        where l.id = location_id
          and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
      )
    )
  );

select pg_temp.grm_drop_select_policies('grm_bulk_jobs');
create policy "grm: owner reads bulk jobs"
  on public.grm_bulk_jobs
  for select
  using (user_id = auth.uid());

select pg_temp.grm_drop_select_policies('grm_groups');
create policy "grm: scoped read groups"
  on public.grm_groups
  for select
  using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.workspace_id = grm_groups.workspace_id
        and (l.group_id = grm_groups.id or l.client_id = grm_groups.client_id)
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
    or exists (
      select 1
      from public.grm_workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id = grm_groups.workspace_id
        and m.access_enabled
        and m.scope_client_id is null
        and m.scope_group_id is null
        and m.scope_location_id is null
    )
  );

select pg_temp.grm_drop_select_policies('grm_brands');
create policy "grm: scoped read brands"
  on public.grm_brands
  for select
  using (
    exists (
      select 1
      from public.grm_google_locations l
      where l.workspace_id = grm_brands.workspace_id
        and l.client_id = grm_brands.client_id
        and public.grm_can_see_location(l.workspace_id, l.client_id, l.group_id, l.id)
    )
    or exists (
      select 1
      from public.grm_workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id = grm_brands.workspace_id
        and m.access_enabled
        and m.scope_client_id is null
        and m.scope_group_id is null
        and m.scope_location_id is null
    )
  );

-- Anon select on tenant tables is unused by the app and depends on RLS to
-- return nothing. Revoke it. Authenticated and service_role grants stay.
revoke select on table
  public.grm_reviews,
  public.grm_review_analyses,
  public.grm_review_observations,
  public.grm_review_replies,
  public.grm_insight_reports,
  public.grm_analysis_runs,
  public.grm_ai_generation_jobs,
  public.grm_bulk_jobs
from anon;

-- These functions are security invoker. Recreating them in 20261022010
-- restored the default public execute grant. The app calls them with the
-- service role.
revoke all on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) to service_role;

revoke all on function public.grm_agency_counts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.grm_agency_counts(uuid, timestamptz, timestamptz) to service_role;

-- Fresh databases from this repo still attach locations.group_id to
-- grm_location_groups. Production attaches it to grm_groups. Align only
-- when the data already matches grm_groups.
do $$
declare
  v_name text;
  v_target regclass;
begin
  select c.conname, c.confrelid::regclass
    into v_name, v_target
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.grm_google_locations'::regclass
    and c.contype = 'f'
    and a.attname = 'group_id'
  limit 1;

  if v_name is null or v_target = 'public.grm_groups'::regclass then
    return;
  end if;

  if exists (
    select 1
    from public.grm_google_locations l
    where l.group_id is not null
      and not exists (select 1 from public.grm_groups g where g.id = l.group_id)
  ) then
    raise exception
      'grm_google_locations.group_id has values that are not in grm_groups. Refusing to retarget the foreign key.';
  end if;

  execute format('alter table public.grm_google_locations drop constraint %I', v_name);
  alter table public.grm_google_locations
    add constraint grm_google_locations_group_id_fkey
    foreign key (group_id) references public.grm_groups(id) on delete set null;
end $$;
