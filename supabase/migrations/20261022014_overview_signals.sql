-- Overview signal aggregates.
--
-- The overview page used to download up to 1,000 complaint-theme rows and
-- 1,000 recent-negative rows per 80 locations into the app server and count
-- them in JavaScript (hiding the data entirely when a page filled up). These
-- aggregates run in Postgres; full counts are returned, never truncated.
--
-- Reverse: drop function public.grm_overview_signals(uuid, uuid[], timestamptz, timestamptz, timestamptz, timestamptz, timestamptz);

create or replace function public.grm_overview_signals(
  p_workspace_id uuid,
  p_location_ids uuid[],
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_recent_start timestamptz default null,
  p_recent_end timestamptz default null,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with themes as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('locationId', location_id, 'theme', theme, 'count', n)
        order by n desc, location_id, theme
      ),
      '[]'::jsonb
    ) as items
    from (
      select
        r.location_id,
        coalesce(r.complaint_theme, 'unspecified') as theme,
        count(*)::int as n
      from public.grm_reviews r
      where r.workspace_id = p_workspace_id
        and r.location_id = any (p_location_ids)
        and r.missing_on_google_at is null
        and r.star_rating <= 3
        and (p_start is null or r.review_create_time >= p_start)
        and (p_end is null or r.review_create_time < p_end)
      group by r.location_id, coalesce(r.complaint_theme, 'unspecified')
    ) grouped
  ),
  recent as (
    select location_id, count(*)::int as n
    from public.grm_reviews r
    where r.workspace_id = p_workspace_id
      and r.location_id = any (p_location_ids)
      and r.missing_on_google_at is null
      and r.star_rating <= 3
      and (p_recent_start is null or r.review_create_time >= p_recent_start)
      and (p_recent_end is null or r.review_create_time < p_recent_end)
    group by r.location_id
    order by count(*) desc, r.location_id
    limit 1
  ),
  overdue as (
    select e.id, e.due_at, e.location_id
    from public.grm_escalations e
    where e.workspace_id = p_workspace_id
      and e.location_id = any (p_location_ids)
      and e.status <> 'resolved'
      and e.due_at < p_now
    order by e.due_at asc
    limit 1
  )
  select jsonb_build_object(
    'themes', (select items from themes),
    'recentTop', (
      select case when exists (select 1 from recent)
        then jsonb_build_object(
          'locationId', (select location_id from recent),
          'count', (select n from recent)
        )
        else null end
    ),
    'oldestOverdue', (
      select case when exists (select 1 from overdue)
        then jsonb_build_object(
          'id', (select id from overdue),
          'dueAt', (select due_at from overdue),
          'locationId', (select location_id from overdue)
        )
        else null end
    )
  );
$$;

comment on function public.grm_overview_signals(uuid, uuid[], timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) is
  'Complaint themes, busiest recent-negative outlet and oldest overdue escalation for the overview page.';

revoke all on function public.grm_overview_signals(uuid, uuid[], timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.grm_overview_signals(uuid, uuid[], timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
