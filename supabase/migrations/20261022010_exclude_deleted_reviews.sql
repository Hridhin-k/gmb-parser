-- Exclude reviews Google has deleted from every user-facing count/list.
--
-- A full sync flags reviews it did not see as missing_on_google_at instead of
-- deleting the row (history is kept, and the flag clears if the review
-- returns). Listings were documented to exclude flagged reviews, but the
-- aggregate RPCs below never did -- so e.g. Palakkad showed 5,301 rows while
-- Google shows 5,298 (3 flagged deletions were being counted).
--
-- Reverse: re-apply the previous definitions from
--   20261016008_hierarchy.sql, 20261008002_date_range_filters.sql,
--   20261001003_review_aggregates.sql, 20261022003_performance.sql.

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
  with bounds as (
    select
      case
        when p_timezone in ('Asia/Kolkata', 'UTC', 'Asia/Dubai', 'America/New_York') then p_timezone
        else 'UTC'
      end as tz
  ),
  placed as (
    select
      r.id,
      r.location_id,
      r.star_rating,
      r.reply_status,
      r.review_create_time,
      r.google_reply_comment,
      r.google_reply_update_time,
      r.complaint_theme,
      r.assigned_to,
      l.group_id
    from public.grm_reviews r
    join public.grm_google_locations l on l.id = r.location_id
    where r.workspace_id = p_workspace_id
      and r.missing_on_google_at is null
      and l.client_id is not null
      and not exists (
        select 1 from public.grm_clients c
        where c.id = l.client_id and c.notes = 'grm:system:unassigned'
      )
      and (p_client_id is null or l.client_id = p_client_id)
      and public.grm_location_in_group(l.group_id, p_group_id)
      and (p_location_id is null or r.location_id = p_location_id)
  ),
  window_bounds as (
    select
      coalesce(p_start, (select min(review_create_time) from placed)) as start_at,
      coalesce(p_end, now()) as end_at,
      b.tz
    from bounds b
  ),
  scoped as (
    select p.*
    from placed p, window_bounds w
    where w.start_at is not null
      and p.review_create_time >= w.start_at
      and p.review_create_time < w.end_at
  ),
  replied as (
    select
      s.*,
      (s.google_reply_comment is not null or s.reply_status = 'published') as has_reply,
      case
        when s.google_reply_update_time is not null
         and s.google_reply_update_time >= s.review_create_time
        then extract(epoch from (s.google_reply_update_time - s.review_create_time)) / 3600
        else null
      end as response_hours
    from scoped s
  ),
  months as (
    select generate_series(
      date_trunc('month', w.start_at at time zone w.tz),
      date_trunc('month', (w.end_at - interval '1 microsecond') at time zone w.tz),
      interval '1 month'
    )::date as month
    from window_bounds w
    where w.start_at is not null and w.start_at < w.end_at
  ),
  month_rows as (
    select
      m.month,
      count(s.id)::int as reviews,
      coalesce(sum(s.star_rating), 0)::int as rating_sum,
      count(s.id) filter (where s.star_rating <= 2)::int as negative,
      count(s.id) filter (where s.star_rating >= 4)::int as positive,
      count(s.id) filter (where s.star_rating <= 3)::int as one_to_three,
      count(s.id) filter (where s.has_reply)::int as replied
    from months m
    left join replied s
      on date_trunc('month', s.review_create_time at time zone (select tz from window_bounds))::date = m.month
    group by m.month
    order by m.month
  ),
  esc as (
    select e.status, e.due_at, e.opened_at, e.resolved_at, e.assignee_user_id, e.resolved_by
    from public.grm_escalations e
    join placed p on p.id = e.review_id
  ),
  esc_window as (
    select e.*
    from esc e, window_bounds w
    where w.start_at is not null
      and e.opened_at >= w.start_at
      and e.opened_at < w.end_at
  )
  select jsonb_build_object(
    'reviews', (select count(*)::int from replied),
    'rating_sum', (select coalesce(sum(star_rating), 0)::int from replied),
    'negative', (select count(*) filter (where star_rating <= 2)::int from replied),
    'one_to_three', (select count(*) filter (where star_rating <= 3)::int from replied),
    'positive', (select count(*) filter (where star_rating >= 4)::int from replied),
    'replied', (select count(*) filter (where has_reply)::int from replied),
    'unreplied', (select count(*) filter (where reply_status = 'none' and google_reply_comment is null)::int from replied),
    'drafts', (select count(*) filter (where reply_status = 'draft')::int from replied),
    'failed', (select count(*) filter (where reply_status = 'failed')::int from replied),
    'response_hours_sum', (select coalesce(sum(response_hours), 0) from replied),
    'response_count', (select count(response_hours)::int from replied),
    'r1', (select count(*) filter (where star_rating = 1)::int from replied),
    'r2', (select count(*) filter (where star_rating = 2)::int from replied),
    'r3', (select count(*) filter (where star_rating = 3)::int from replied),
    'r4', (select count(*) filter (where star_rating = 4)::int from replied),
    'r5', (select count(*) filter (where star_rating = 5)::int from replied),
    'under_1h', (select count(*) filter (where response_hours < 1)::int from replied),
    'under_24h', (select count(*) filter (where response_hours >= 1 and response_hours < 24)::int from replied),
    'under_3d', (select count(*) filter (where response_hours >= 24 and response_hours < 72)::int from replied),
    'later', (select count(*) filter (where response_hours >= 72)::int from replied),
    'open_escalations', (select count(*) filter (where status <> 'resolved')::int from esc_window),
    'overdue_escalations', (
      select count(*) filter (where status <> 'resolved' and due_at < now())::int from esc_window
    ),
    'pending_now', (select count(*) filter (where reply_status = 'pending_publish')::int from placed),
    'months', coalesce((select jsonb_agg(to_jsonb(month_rows) order by month) from month_rows), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          location_id,
          count(*)::int as reviews,
          coalesce(sum(star_rating), 0)::int as rating_sum,
          count(*) filter (where star_rating <= 3)::int as one_to_three,
          count(*) filter (where has_reply)::int as replied,
          count(*) filter (where reply_status = 'none' and google_reply_comment is null)::int as unreplied,
          count(*) filter (where reply_status = 'draft')::int as drafts,
          coalesce(sum(response_hours), 0) as response_hours_sum,
          count(response_hours)::int as response_count
        from replied
        group by location_id
      ) x
    ), '[]'::jsonb),
    'theme_months', coalesce((
      select jsonb_agg(row_to_json(x) order by x.month)
      from (
        select
          date_trunc('month', review_create_time at time zone (select tz from window_bounds))::date as month,
          coalesce(complaint_theme, 'unspecified') as theme,
          count(*)::int as count
        from replied
        where star_rating <= 3
        group by 1, 2
      ) x
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          group_id,
          count(*)::int as reviews,
          coalesce(sum(star_rating), 0)::int as rating_sum,
          count(*) filter (where star_rating <= 3)::int as one_to_three,
          count(*) filter (where has_reply)::int as replied
        from replied
        group by group_id
      ) x
    ), '[]'::jsonb),
    'theme_groups', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          group_id,
          coalesce(complaint_theme, 'unspecified') as theme,
          count(*)::int as count
        from replied
        where star_rating <= 3
        group by 1, 2
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
          select assigned_to as user_id, count(*)::int as assigned_reviews, 0 as open_escalations, 0 as resolved_escalations
          from replied
          where assigned_to is not null
          group by assigned_to
          union all
          select assignee_user_id, 0, count(*)::int, 0
          from esc_window
          where assignee_user_id is not null and status <> 'resolved'
          group by assignee_user_id
          union all
          select resolved_by, 0, 0, count(*)::int
          from esc e, window_bounds w
          where e.resolved_by is not null
            and e.resolved_at is not null
            and w.start_at is not null
            and e.resolved_at >= w.start_at
            and e.resolved_at < w.end_at
          group by resolved_by
        ) parts
        group by user_id
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) to service_role;

create or replace function public.grm_alert_location_window(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      l.id as location_id,
      l.location_title,
      count(r.id)::int as reviews,
      coalesce(sum(r.star_rating), 0)::numeric as rating_sum,
      count(r.id) filter (where r.star_rating <= 3)::int as low_stars
    from public.grm_google_locations l
    left join public.grm_reviews r
      on r.location_id = l.id
     and r.workspace_id = p_workspace_id
     and r.missing_on_google_at is null
     and r.review_create_time >= p_start
     and r.review_create_time < p_end
    where l.workspace_id = p_workspace_id
      and (p_client_id is null or l.client_id = p_client_id)
      and public.grm_location_in_group(l.group_id, p_group_id)
      and (p_location_id is null or l.id = p_location_id)
    group by l.id, l.location_title
  ) x;
$$;

revoke all on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz) to service_role;

create or replace function public.grm_alert_keyword_reviews(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_keywords text[]
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      r.id as review_id,
      r.location_id,
      l.location_title,
      r.star_rating,
      r.comment,
      r.review_create_time
    from public.grm_reviews r
    join public.grm_google_locations l on l.id = r.location_id
    where r.workspace_id = p_workspace_id
      and r.missing_on_google_at is null
      and r.comment is not null
      and r.review_create_time >= p_start
      and r.review_create_time < p_end
      and (p_client_id is null or l.client_id = p_client_id)
      and public.grm_location_in_group(l.group_id, p_group_id)
      and (p_location_id is null or l.id = p_location_id)
      and exists (
        select 1
        from unnest(coalesce(p_keywords, array[]::text[])) as keyword
        where char_length(keyword) >= 3
          and r.comment ilike '%' || replace(keyword, '%', '') || '%'
      )
    order by r.review_create_time desc
    limit 200
  ) x;
$$;

revoke all on function public.grm_alert_keyword_reviews(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.grm_alert_keyword_reviews(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text[]) to service_role;

create or replace function public.grm_review_trends(
  p_workspace_id uuid,
  p_months       integer default 12,
  p_client_id    uuid default null,
  p_location_id  uuid default null,
  p_start        timestamptz default null,
  p_end          timestamptz default null
)
returns table (
  month              date,
  review_count       integer,
  avg_rating         numeric,
  negative           integer,
  positive           integer,
  replied            integer,
  avg_response_hours numeric
)
language sql
stable
set search_path = public
as $$
  with in_scope as (
    select r.*
    from public.grm_reviews r
    join public.grm_google_locations l on l.id = r.location_id
    where r.workspace_id = p_workspace_id
      and r.missing_on_google_at is null
      and (p_client_id is null or l.client_id = p_client_id)
      and (p_location_id is null or r.location_id = p_location_id)
  ),
  bounds as (
    select
      coalesce(
        p_start,
        case
          when p_months is null then (select min(review_create_time) from in_scope)
          else date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1)
        end
      ) as start_at,
      coalesce(p_end, now()) as end_at
  ),
  months as (
    select generate_series(
      date_trunc('month', b.start_at),
      date_trunc('month', b.end_at - interval '1 microsecond'),
      interval '1 month'
    )::date as month
    from bounds b
    where b.start_at is not null and b.start_at < b.end_at
  ),
  scoped as (
    select s.*
    from in_scope s, bounds b
    where s.review_create_time >= b.start_at
      and s.review_create_time < b.end_at
  )
  select
    m.month,
    count(s.id)::int,
    round(avg(s.star_rating)::numeric, 2),
    count(s.id) filter (where s.star_rating <= 2)::int,
    count(s.id) filter (where s.star_rating >= 4)::int,
    count(s.id) filter (where s.google_reply_comment is not null or s.reply_status = 'published')::int,
    round(
      avg(extract(epoch from (s.google_reply_update_time - s.review_create_time)) / 3600)
        filter (where s.google_reply_update_time is not null
                and s.google_reply_update_time >= s.review_create_time)::numeric,
      1
    )
  from months m
  left join scoped s on date_trunc('month', s.review_create_time)::date = m.month
  group by m.month
  order by m.month;
$$;

revoke all on function public.grm_review_trends(uuid, integer, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.grm_review_trends(uuid, integer, uuid, uuid, timestamptz, timestamptz) to service_role;

create or replace function public.grm_location_review_counts(
  p_workspace_id uuid,
  p_start        timestamptz default null,
  p_end          timestamptz default null
)
returns table (location_id uuid, review_count integer)
language sql
stable
set search_path = public
as $$
  select r.location_id, count(*)::int
  from public.grm_reviews r
  where r.workspace_id = p_workspace_id
    and r.missing_on_google_at is null
    and (p_start is null or r.review_create_time >= p_start)
    and (p_end is null or r.review_create_time < p_end)
  group by r.location_id;
$$;

revoke all on function public.grm_location_review_counts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.grm_location_review_counts(uuid, timestamptz, timestamptz) to service_role;

create or replace function public.grm_location_review_stats(p_workspace_id uuid)
returns table (
  location_id    uuid,
  review_count   integer,
  unanswered     integer,
  drafts         integer,
  approved       integer,
  failed         integer,
  published      integer,
  critical       integer,
  rating_sum     bigint,
  r1             integer,
  r2             integer,
  r3             integer,
  r4             integer,
  r5             integer,
  last_7d        integer,
  last_30d       integer,
  last_review_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    r.location_id,
    count(*)::int,
    count(*) filter (where r.reply_status = 'none')::int,
    count(*) filter (where r.reply_status = 'draft')::int,
    count(*) filter (where r.reply_status in ('approved', 'pending_publish'))::int,
    count(*) filter (where r.reply_status = 'failed')::int,
    count(*) filter (where r.reply_status = 'published')::int,
    count(*) filter (where r.star_rating <= 2)::int,
    sum(r.star_rating)::bigint,
    count(*) filter (where r.star_rating = 1)::int,
    count(*) filter (where r.star_rating = 2)::int,
    count(*) filter (where r.star_rating = 3)::int,
    count(*) filter (where r.star_rating = 4)::int,
    count(*) filter (where r.star_rating = 5)::int,
    count(*) filter (where r.review_create_time >= now() - interval '7 days')::int,
    count(*) filter (where r.review_create_time >= now() - interval '30 days')::int,
    max(r.review_create_time)
  from public.grm_reviews r
  where r.workspace_id = p_workspace_id
    and r.missing_on_google_at is null
  group by r.location_id;
$$;

revoke all on function public.grm_location_review_stats(uuid) from public, anon, authenticated;
grant execute on function public.grm_location_review_stats(uuid) to service_role;

create or replace function public.grm_star_breakdown(
  p_workspace_id uuid,
  p_location_ids uuid[],
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_timezone text default 'UTC'
)
returns table (
  month date,
  location_id uuid,
  star_rating integer,
  complaint_theme text,
  review_count bigint
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      case
        when p_timezone in ('Asia/Kolkata', 'UTC', 'Asia/Dubai', 'America/New_York') then p_timezone
        else 'UTC'
      end as tz
  )
  select
    (date_trunc('month', r.review_create_time at time zone (select tz from bounds)))::date as month,
    r.location_id,
    r.star_rating,
    r.complaint_theme,
    count(*)::bigint as review_count
  from public.grm_reviews r
  where r.workspace_id = p_workspace_id
    and r.missing_on_google_at is null
    and r.location_id = any (p_location_ids)
    and (p_start is null or r.review_create_time >= p_start)
    and (p_end is null or r.review_create_time < p_end)
  group by 1, 2, 3, 4
$$;

create or replace function public.grm_agency_counts(
  p_workspace_id uuid,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'published', coalesce((select jsonb_agg(x) from (
      select r.location_id as location_id, count(*)::bigint as n
      from public.grm_review_replies rp
      join public.grm_reviews r on r.id = rp.review_id
      where rp.workspace_id = p_workspace_id
        and r.missing_on_google_at is null
        and rp.status = 'published'
        and (p_start is null or rp.published_at >= p_start)
        and (p_end is null or rp.published_at < p_end)
      group by r.location_id
    ) x), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(x) from (
      select r.location_id as location_id, count(*)::bigint as n
      from public.grm_review_replies rp
      join public.grm_reviews r on r.id = rp.review_id
      where rp.workspace_id = p_workspace_id
        and r.missing_on_google_at is null
        and rp.client_approval = 'requested'
      group by r.location_id
    ) x), '[]'::jsonb),
    'escalations', coalesce((select jsonb_agg(x) from (
      select e.location_id as location_id, count(*)::bigint as n
      from public.grm_escalations e
      where e.workspace_id = p_workspace_id
        and e.resolved_at is null
      group by e.location_id
    ) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x) from (
      select ev.client_id as client_id, count(*)::bigint as n
      from public.grm_usage_events ev
      where ev.workspace_id = p_workspace_id
        and ev.client_id is not null
        and (p_start is null or ev.occurred_at >= p_start)
        and (p_end is null or ev.occurred_at < p_end)
      group by ev.client_id
    ) x), '[]'::jsonb)
  );
$$;
