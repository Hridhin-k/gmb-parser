-- One aggregation for the overview and analytics screens.
-- Month buckets use the workspace timezone. Review windows stay [start, end).

alter table public.grm_escalation_policies
  add column if not exists reply_rate_target numeric;

do $$
begin
  alter table public.grm_escalation_policies
    add constraint grm_escalation_policies_reply_target_check
    check (reply_rate_target is null or (reply_rate_target >= 0 and reply_rate_target <= 1));
exception
  when duplicate_object then null;
end $$;

comment on column public.grm_escalation_policies.reply_rate_target is
  'Saved reply-rate target as a fraction from 0 to 1. Null means no target is set.';

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
      and l.client_id is not null
      and not exists (
        select 1 from public.grm_clients c
        where c.id = l.client_id and c.notes = 'grm:system:unassigned'
      )
      and (p_client_id is null or l.client_id = p_client_id)
      and (p_group_id is null or l.group_id = p_group_id)
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

revoke all on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text)
  to service_role;
