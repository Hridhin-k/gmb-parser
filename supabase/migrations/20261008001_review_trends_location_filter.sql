-- Analytics: allow filtering monthly trends by a single location.
drop function if exists public.grm_review_trends(uuid, integer, uuid);

create or replace function public.grm_review_trends(
  p_workspace_id uuid,
  p_months       integer default 12,
  p_client_id    uuid default null,
  p_location_id  uuid default null
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
      and (p_location_id is null or r.location_id = p_location_id)
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

revoke all on function public.grm_review_trends(uuid, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.grm_review_trends(uuid, integer, uuid, uuid) to service_role;
