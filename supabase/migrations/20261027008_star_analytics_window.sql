-- Star breakdown and analytics summary spent generic-plan time on optional
-- date predicates written as (p_start is null or review_create_time >= p_start).
--
-- On staging (largest tenant 40,050 reviews, 5 locations) EXPLAIN (ANALYZE,
-- BUFFERS) of the star-breakdown body for a 30-day window showed:
--   Index Cond on (workspace_id, location_id)
--   Filter with the OR-null date tests removed 39,967 of ~40,050 rows
--   ~121k shared buffer hits, ~45 ms
-- The same body with
--   review_create_time >= coalesce(p_start, '-infinity')
--   review_create_time <  coalesce(p_end, 'infinity')
-- put the window into the index path (~0.7 ms, ~630 hits) and returned the
-- same 36 groups / 83 reviews.
--
-- grm_analytics_slice only calls grm_analytics_summary, so fixing the summary
-- covers the analytics page RPC. Response shape, timezone allow-list, grants,
-- and missing_on_google_at exclusion are unchanged. No new indexes.
--
-- Rollback: re-apply public.grm_star_breakdown from
-- 20261022010_exclude_deleted_reviews.sql and public.grm_analytics_summary
-- from 20261022013_analytics_slice.sql.
-- Do not apply this to production until it has been reviewed.

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
    and r.review_create_time >= coalesce(p_start, '-infinity'::timestamptz)
    and r.review_create_time < coalesce(p_end, 'infinity'::timestamptz)
  group by 1, 2, 3, 4
$$;

create or replace function public.grm_analytics_summary(
  p_workspace_id uuid,
  p_location_ids uuid[],
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_include_auto boolean default false
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select
      r.star_rating,
      r.review_language,
      (
        (r.google_reply_comment is not null and r.google_reply_comment <> '')
        or r.reply_status = 'published'
      ) as has_reply,
      case
        when r.google_reply_update_time is null then null
        when r.google_reply_update_time < r.review_create_time then null
        else extract(epoch from (r.google_reply_update_time - r.review_create_time)) / 3600.0
      end as hours,
      case when p_include_auto then pub.has_pub end as has_pub,
      case when p_include_auto then coalesce(pub.is_ai, false) end as is_ai
    from public.grm_reviews r
    left join (
      select review_id, true as has_pub, bool_or(source = 'ai') as is_ai
      from public.grm_review_replies
      where status = 'published'
      group by review_id
    ) pub on pub.review_id = r.id
    where r.workspace_id = p_workspace_id
      and r.location_id = any (p_location_ids)
      and r.missing_on_google_at is null
      and r.review_create_time >= coalesce(p_start, '-infinity'::timestamptz)
      and r.review_create_time < coalesce(p_end, 'infinity'::timestamptz)
  ),
  bucketed as (
    select
      *,
      case
        when hours is null then null
        when hours < 1 then 'under1h'
        when hours < 6 then 'h1to6'
        when hours < 24 then 'h6to24'
        else 'over24h'
      end as bucket
    from base
  ),
  agg as (
    select
      count(*)::int as reviews,
      coalesce(sum(star_rating), 0)::float8 as rating_sum,
      count(*) filter (where has_reply)::int as replied,
      count(*) filter (where has_reply and hours is null)::int as untimed_replies,
      (percentile_cont(0.5) within group (order by hours))::float8 as median_hours,
      count(*) filter (where has_pub)::int as published_here,
      count(*) filter (where has_pub and is_ai)::int as auto_ai,
      count(*) filter (where bucket = 'under1h')::int as b_under1h,
      count(*) filter (where bucket = 'h1to6')::int as b_h1to6,
      count(*) filter (where bucket = 'h6to24')::int as b_h6to24,
      count(*) filter (where bucket = 'over24h')::int as b_over24h,
      array[
        count(*) filter (where bucket = 'under1h' and star_rating = 1)::int,
        count(*) filter (where bucket = 'under1h' and star_rating = 2)::int,
        count(*) filter (where bucket = 'under1h' and star_rating = 3)::int,
        count(*) filter (where bucket = 'under1h' and star_rating = 4)::int,
        count(*) filter (where bucket = 'under1h' and star_rating = 5)::int
      ] as s_under1h,
      array[
        count(*) filter (where bucket = 'h1to6' and star_rating = 1)::int,
        count(*) filter (where bucket = 'h1to6' and star_rating = 2)::int,
        count(*) filter (where bucket = 'h1to6' and star_rating = 3)::int,
        count(*) filter (where bucket = 'h1to6' and star_rating = 4)::int,
        count(*) filter (where bucket = 'h1to6' and star_rating = 5)::int
      ] as s_h1to6,
      array[
        count(*) filter (where bucket = 'h6to24' and star_rating = 1)::int,
        count(*) filter (where bucket = 'h6to24' and star_rating = 2)::int,
        count(*) filter (where bucket = 'h6to24' and star_rating = 3)::int,
        count(*) filter (where bucket = 'h6to24' and star_rating = 4)::int,
        count(*) filter (where bucket = 'h6to24' and star_rating = 5)::int
      ] as s_h6to24,
      array[
        count(*) filter (where bucket = 'over24h' and star_rating = 1)::int,
        count(*) filter (where bucket = 'over24h' and star_rating = 2)::int,
        count(*) filter (where bucket = 'over24h' and star_rating = 3)::int,
        count(*) filter (where bucket = 'over24h' and star_rating = 4)::int,
        count(*) filter (where bucket = 'over24h' and star_rating = 5)::int
      ] as s_over24h
    from bucketed
  ),
  langs as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', lang_id, 'count', n)
        order by n desc, lang_id asc
      ),
      '[]'::jsonb
    ) as languages
    from (
      select coalesce(review_language, 'unset') as lang_id, count(*)::int as n
      from bucketed
      group by 1
    ) grouped
  )
  select jsonb_build_object(
    'reviews', agg.reviews,
    'ratingSum', agg.rating_sum,
    'replied', agg.replied,
    'medianHours', agg.median_hours,
    'untimedReplies', agg.untimed_replies,
    'buckets', jsonb_build_object(
      'under1h', agg.b_under1h,
      'h1to6', agg.b_h1to6,
      'h6to24', agg.b_h6to24,
      'over24h', agg.b_over24h
    ),
    'bucketStars', jsonb_build_object(
      'under1h', to_jsonb(agg.s_under1h),
      'h1to6', to_jsonb(agg.s_h1to6),
      'h6to24', to_jsonb(agg.s_h6to24),
      'over24h', to_jsonb(agg.s_over24h)
    ),
    'languages', langs.languages,
    'publishedHere', agg.published_here,
    'autoAi', agg.auto_ai
  )
  from agg cross join langs;
$$;

comment on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) is
  'Per-location star and theme counts for a review window. Uses coalesce bounds so generic plans keep the create_time predicate indexable.';
comment on function public.grm_analytics_summary(uuid, uuid[], timestamptz, timestamptz, boolean) is
  'Reply-time, language and rating summary for a review window. Uses coalesce bounds so generic plans keep the create_time predicate indexable.';

revoke all on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) to service_role;
revoke all on function public.grm_analytics_summary(uuid, uuid[], timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.grm_analytics_summary(uuid, uuid[], timestamptz, timestamptz, boolean) to service_role;
