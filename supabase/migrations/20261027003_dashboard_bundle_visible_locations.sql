-- All-time dashboard bundle spent most of its generic-plan time anti-joining
-- grm_clients once per review. On the local bench (largest tenant 40,050
-- reviews, 5 locations) EXPLAIN (ANALYZE, BUFFERS) showed:
--   Nested Loop Anti Join after the review explode
--   Seq Scan on grm_clients with loops=40050 (~80,100 of ~120,512 buffer hits)
--   Sort of 40,050 rows spilled to disk (external merge, 3272kB) at work_mem 4MB
-- The custom plan already anti-joined the 5 locations first (~4 buffer hits).
--
-- This rewrite keeps the same filters and JSON shape. The unassigned-client
-- and scope checks run once over locations in a MATERIALIZED CTE, then reviews
-- join that short list. Date predicates, deleted-review exclusion, GROUPING
-- SETS, and the public signature are unchanged. Sort spill on all-time remains
-- and is left for a later phase (no work_mem or index change here).
--
-- Rollback: re-apply the grm_dashboard_bundle body from
-- 20261027002_dashboard_bundle_window.sql.
-- Do not apply this to production until it has been reviewed.

create or replace function public.grm_dashboard_bundle(
  p_workspace_id uuid,
  p_client_id uuid default null,
  p_group_id uuid default null,
  p_location_id uuid default null,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_timezone text default 'UTC'
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with visible_locations as materialized (
    select l.id as location_id, l.group_id
    from public.grm_google_locations l
    where l.workspace_id = p_workspace_id
      and l.client_id is not null
      and (p_client_id is null or l.client_id = p_client_id)
      and not exists (
        select 1 from public.grm_clients c
        where c.id = l.client_id and c.notes = 'grm:system:unassigned'
      )
      and public.grm_location_in_group(l.group_id, p_group_id)
      and (p_location_id is null or l.id = p_location_id)
  ),
  agg as (
    select
      location_id,
      group_id,
      month,
      theme,
      assigned_to,
      grouping(location_id) as g_location,
      grouping(group_id) as g_group,
      grouping(month) as g_month,
      grouping(theme) as g_theme,
      grouping(assigned_to) as g_assigned,
      count(*)::int as reviews,
      coalesce(sum(star_rating), 0)::int as rating_sum,
      count(*) filter (where star_rating <= 2)::int as negative,
      count(*) filter (where star_rating <= 3)::int as one_to_three,
      count(*) filter (where star_rating >= 4)::int as positive,
      count(*) filter (where has_reply)::int as replied,
      count(*) filter (where reply_status = 'none' and google_reply_comment is null)::int as unreplied,
      count(*) filter (where reply_status = 'draft')::int as drafts,
      count(*) filter (where reply_status = 'failed')::int as failed,
      coalesce(sum(response_hours), 0) as response_hours_sum,
      count(response_hours)::int as response_count,
      count(*) filter (where star_rating = 1)::int as r1,
      count(*) filter (where star_rating = 2)::int as r2,
      count(*) filter (where star_rating = 3)::int as r3,
      count(*) filter (where star_rating = 4)::int as r4,
      count(*) filter (where star_rating = 5)::int as r5,
      count(*) filter (where response_hours < 1)::int as under_1h,
      count(*) filter (where response_hours >= 1 and response_hours < 24)::int as under_24h,
      count(*) filter (where response_hours >= 24 and response_hours < 72)::int as under_3d,
      count(*) filter (where response_hours >= 72)::int as later,
      count(*) filter (where star_rating <= 3)::int as low_stars,
      min(review_create_time) as min_time
    from (
      select
        r.location_id,
        vl.group_id,
        r.star_rating,
        r.reply_status,
        r.review_create_time,
        r.google_reply_comment,
        r.assigned_to,
        date_trunc(
          'month',
          r.review_create_time at time zone (
            case
              when p_timezone in ('Asia/Kolkata', 'UTC', 'Asia/Dubai', 'America/New_York') then p_timezone
              else 'UTC'
            end
          )
        )::date as month,
        coalesce(r.complaint_theme, 'unspecified') as theme,
        (r.google_reply_comment is not null or r.reply_status = 'published') as has_reply,
        case
          when r.google_reply_update_time is not null
           and r.google_reply_update_time >= r.review_create_time
          then extract(epoch from (r.google_reply_update_time - r.review_create_time)) / 3600
          else null
        end as response_hours
      from public.grm_reviews r
      join visible_locations vl on vl.location_id = r.location_id
      where r.workspace_id = p_workspace_id
        and r.missing_on_google_at is null
        and r.review_create_time >= coalesce(p_start, '-infinity'::timestamptz)
        and r.review_create_time < coalesce(p_end, now())
    ) scoped
    group by grouping sets (
      (),
      (location_id),
      (group_id),
      (month),
      (assigned_to),
      (month, theme),
      (group_id, theme)
    )
  ),
  totals as (
    select *
    from agg
    where g_location = 1 and g_group = 1 and g_month = 1 and g_theme = 1 and g_assigned = 1
  ),
  span as (
    select
      coalesce(p_start, (select min_time from totals)) as start_at,
      coalesce(p_end, now()) as end_at,
      case
        when p_timezone in ('Asia/Kolkata', 'UTC', 'Asia/Dubai', 'America/New_York') then p_timezone
        else 'UTC'
      end as tz
  ),
  months as (
    select generate_series(
      date_trunc('month', s.start_at at time zone s.tz),
      date_trunc('month', (s.end_at - interval '1 microsecond') at time zone s.tz),
      interval '1 month'
    )::date as month
    from span s
    where s.start_at is not null and s.start_at < s.end_at
  ),
  month_rows as (
    select
      m.month,
      coalesce(c.reviews, 0)::int as reviews,
      coalesce(c.rating_sum, 0)::int as rating_sum,
      coalesce(c.negative, 0)::int as negative,
      coalesce(c.positive, 0)::int as positive,
      coalesce(c.one_to_three, 0)::int as one_to_three,
      coalesce(c.replied, 0)::int as replied
    from months m
    left join agg c
      on c.month = m.month
     and c.g_month = 0 and c.g_theme = 1 and c.g_location = 1 and c.g_group = 1 and c.g_assigned = 1
    order by m.month
  ),
  esc as (
    select e.status, e.due_at, e.opened_at, e.resolved_at, e.assignee_user_id, e.resolved_by
    from public.grm_escalations e
    join public.grm_reviews r on r.id = e.review_id
    join visible_locations vl on vl.location_id = r.location_id
    where r.workspace_id = p_workspace_id
      and r.missing_on_google_at is null
  ),
  esc_window as (
    select e.*
    from esc e
    cross join span s
    where s.start_at is not null
      and e.opened_at >= s.start_at
      and e.opened_at < s.end_at
  )
  select jsonb_build_object(
    'reviews', coalesce((select reviews from totals), 0),
    'rating_sum', coalesce((select rating_sum from totals), 0),
    'negative', coalesce((select negative from totals), 0),
    'one_to_three', coalesce((select one_to_three from totals), 0),
    'positive', coalesce((select positive from totals), 0),
    'replied', coalesce((select replied from totals), 0),
    'unreplied', coalesce((select unreplied from totals), 0),
    'drafts', coalesce((select drafts from totals), 0),
    'failed', coalesce((select failed from totals), 0),
    'response_hours_sum', coalesce((select response_hours_sum from totals), 0),
    'response_count', coalesce((select response_count from totals), 0),
    'r1', coalesce((select r1 from totals), 0),
    'r2', coalesce((select r2 from totals), 0),
    'r3', coalesce((select r3 from totals), 0),
    'r4', coalesce((select r4 from totals), 0),
    'r5', coalesce((select r5 from totals), 0),
    'under_1h', coalesce((select under_1h from totals), 0),
    'under_24h', coalesce((select under_24h from totals), 0),
    'under_3d', coalesce((select under_3d from totals), 0),
    'later', coalesce((select later from totals), 0),
    'open_escalations', (select count(*) filter (where status <> 'resolved')::int from esc_window),
    'overdue_escalations', (
      select count(*) filter (where status <> 'resolved' and due_at < now())::int from esc_window
    ),
    'pending_now', (
      select count(*)::int
      from public.grm_reviews r
      join visible_locations vl on vl.location_id = r.location_id
      where r.workspace_id = p_workspace_id
        and r.missing_on_google_at is null
        and r.reply_status = 'pending_publish'
    ),
    'months', coalesce((select jsonb_agg(to_jsonb(month_rows) order by month) from month_rows), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          location_id,
          reviews,
          rating_sum,
          one_to_three,
          replied,
          unreplied,
          drafts,
          response_hours_sum,
          response_count
        from agg
        where g_location = 0 and g_group = 1 and g_month = 1 and g_theme = 1 and g_assigned = 1
      ) x
    ), '[]'::jsonb),
    'theme_months', coalesce((
      select jsonb_agg(row_to_json(x) order by x.month)
      from (
        select month, theme, low_stars as count
        from agg
        where g_month = 0 and g_theme = 0 and g_location = 1 and g_group = 1 and g_assigned = 1
          and low_stars > 0
      ) x
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select group_id, reviews, rating_sum, one_to_three, replied
        from agg
        where g_group = 0 and g_location = 1 and g_month = 1 and g_theme = 1 and g_assigned = 1
      ) x
    ), '[]'::jsonb),
    'theme_groups', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select group_id, theme, low_stars as count
        from agg
        where g_group = 0 and g_theme = 0 and g_location = 1 and g_month = 1 and g_assigned = 1
          and low_stars > 0
      ) x
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          user_id,
          coalesce(sum(assigned_reviews), 0)::int as assigned_reviews,
          coalesce(sum(open_escalations), 0)::int as open_escalations,
          coalesce(sum(resolved_escalations), 0)::int as resolved_escalations
        from (
          select assigned_to as user_id, reviews as assigned_reviews, 0 as open_escalations, 0 as resolved_escalations
          from agg
          where g_assigned = 0 and g_location = 1 and g_group = 1 and g_month = 1 and g_theme = 1
            and assigned_to is not null
          union all
          select assignee_user_id, 0, count(*)::int, 0
          from esc_window
          where assignee_user_id is not null and status <> 'resolved'
          group by assignee_user_id
          union all
          select e.resolved_by, 0, 0, count(*)::int
          from esc e
          cross join span s
          where e.resolved_by is not null
            and e.resolved_at is not null
            and s.start_at is not null
            and e.resolved_at >= s.start_at
            and e.resolved_at < s.end_at
          group by e.resolved_by
        ) parts
        group by user_id
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) to service_role;
