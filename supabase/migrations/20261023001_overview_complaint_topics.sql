-- Main complaint on Overview comes from analysed insight observations.
--
-- The previous function returned keyword complaint_theme counts. Those tags
-- treat any mention of "service" as Staff and leave most 1–3 star reviews
-- unspecified, so the column did not match the Insights page. This returns
-- each outlet's negative topic with the most mentions. Only observations
-- whose analysis is ready are counted, the same join the insight dashboard
-- uses for topic charts.
--
-- Reverse: restore supabase/migrations/20261022014_overview_signals.sql.

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
  with complaints as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('locationId', location_id, 'topic', topic, 'count', n)
        order by n desc, location_id, topic
      ),
      '[]'::jsonb
    ) as items
    from (
      select location_id, topic, n
      from (
        select
          location_id,
          topic,
          n,
          row_number() over (
            partition by location_id
            order by n desc, topic asc
          ) as rn
        from (
          select
            o.location_id,
            o.topic,
            count(*)::int as n
          from public.grm_review_observations o
          join public.grm_review_analyses a
            on a.id = o.analysis_id
           and a.status = 'ready'
          where o.workspace_id = p_workspace_id
            and o.location_id = any (p_location_ids)
            and o.sentiment = 'negative'
            and (p_start is null or o.review_create_time >= p_start)
            and (p_end is null or o.review_create_time < p_end)
          group by o.location_id, o.topic
        ) counted
      ) ranked
      where rn = 1
    ) top_topic
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
    'complaints', (select items from complaints),
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
  'Top negative insight topic per outlet, busiest recent 1–3 star outlet, and oldest overdue escalation for the overview page.';
