-- Review aggregates computed in Postgres.
-- PostgREST caps row responses (max_rows), so counting reviews client-side
-- undercounts once a workspace passes that limit.

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
  group by r.location_id;
$$;

create or replace function public.grm_review_trends(
  p_workspace_id uuid,
  p_months       integer default 12,
  p_client_id    uuid default null
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
  with months as (
    select generate_series(
      date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1),
      date_trunc('month', now()),
      interval '1 month'
    )::date as month
  ),
  scoped as (
    select r.*
    from public.grm_reviews r
    join public.grm_google_locations l on l.id = r.location_id
    where r.workspace_id = p_workspace_id
      and (p_client_id is null or l.client_id = p_client_id)
      and r.review_create_time >= date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1)
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

revoke all on function public.grm_location_review_stats(uuid) from public, anon, authenticated;
revoke all on function public.grm_review_trends(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.grm_location_review_stats(uuid) to service_role;
grant execute on function public.grm_review_trends(uuid, integer, uuid) to service_role;
