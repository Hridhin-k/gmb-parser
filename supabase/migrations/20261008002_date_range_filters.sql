-- Date-range filters: analytics trends and usage counts for any window
-- (last N months, custom dates, or all time).

drop function if exists public.grm_review_trends(uuid, integer, uuid, uuid);

-- Window: [p_start, p_end). Without p_start, the last p_months calendar months;
-- with p_months null as well, from the first review in scope (all time).
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

revoke all on function public.grm_review_trends(uuid, integer, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grm_review_trends(uuid, integer, uuid, uuid, timestamptz, timestamptz)
  to service_role;

-- Reviews received per location in [p_start, p_end). Nulls mean unbounded.
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
    and (p_start is null or r.review_create_time >= p_start)
    and (p_end is null or r.review_create_time < p_end)
  group by r.location_id;
$$;

revoke all on function public.grm_location_review_counts(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grm_location_review_counts(uuid, timestamptz, timestamptz)
  to service_role;
