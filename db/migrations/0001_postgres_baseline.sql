-- Fresh-install baseline: native Postgres + Auth.js. No Supabase roles or services.
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3 (Homebrew)
-- Dumped by pg_dump version 18.3 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: authn; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA authn;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: grm_ai_draft_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_ai_draft_status AS ENUM (
    'generated',
    'edited',
    'discarded'
);


--
-- Name: grm_connection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_connection_status AS ENUM (
    'active',
    'expired',
    'revoked'
);


--
-- Name: grm_member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_member_role AS ENUM (
    'owner',
    'admin',
    'member',
    'org_admin',
    'brand_manager',
    'group_manager',
    'store_manager',
    'agent',
    'auditor'
);


--
-- Name: grm_reply_pub_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_reply_pub_status AS ENUM (
    'draft',
    'approved',
    'pending_publish',
    'published',
    'failed'
);


--
-- Name: grm_reply_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_reply_source AS ENUM (
    'ai',
    'manual'
);


--
-- Name: grm_reply_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_reply_status AS ENUM (
    'none',
    'draft',
    'approved',
    'pending_publish',
    'published',
    'failed'
);


--
-- Name: grm_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grm_sync_status AS ENUM (
    'idle',
    'syncing',
    'success',
    'partial',
    'failed'
);


--
-- Name: grm_agency_counts(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_agency_counts(p_workspace_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION grm_agency_counts(p_workspace_id uuid, p_start timestamp with time zone, p_end timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_agency_counts(p_workspace_id uuid, p_start timestamp with time zone, p_end timestamp with time zone) IS 'Per-location/per-client activity counts for the agency portfolio page. Replaces downloading reply/event/escalation/review rows to count them in the app.';


--
-- Name: grm_alert_keyword_reviews(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_alert_keyword_reviews(p_workspace_id uuid, p_client_id uuid, p_group_id uuid, p_location_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_keywords text[]) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: grm_alert_location_window(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_alert_location_window(p_workspace_id uuid, p_client_id uuid, p_group_id uuid, p_location_id uuid, p_start timestamp with time zone, p_end timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: grm_analytics_slice(uuid, uuid[], timestamp with time zone, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_analytics_slice(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_onboarding_completed_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'window', public.grm_analytics_summary(p_workspace_id, p_location_ids, p_start, p_end, true),
    'before', case
      when p_onboarding_completed_at is null then public.grm_analytics_summary(p_workspace_id, '{}'::uuid[], null, null, false)
      else public.grm_analytics_summary(p_workspace_id, p_location_ids, null, p_onboarding_completed_at, false)
    end,
    'after', case
      when p_onboarding_completed_at is null then public.grm_analytics_summary(p_workspace_id, '{}'::uuid[], null, null, false)
      else public.grm_analytics_summary(p_workspace_id, p_location_ids, p_onboarding_completed_at, null, false)
    end
  );
$$;


--
-- Name: FUNCTION grm_analytics_slice(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_onboarding_completed_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_analytics_slice(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_onboarding_completed_at timestamp with time zone) IS 'Window + onboarding before/after summaries for the analytics page.';


--
-- Name: grm_analytics_summary(uuid, uuid[], timestamp with time zone, timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_analytics_summary(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_include_auto boolean DEFAULT false) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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
      and (p_start is null or r.review_create_time >= p_start)
      and (p_end is null or r.review_create_time < p_end)
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


--
-- Name: FUNCTION grm_analytics_summary(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_include_auto boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_analytics_summary(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_include_auto boolean) IS 'Reply-time, language and rating summary for a review window. Replaces downloading review rows to summarise them in the app.';


--
-- Name: grm_assign_escalation_ticket(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_assign_escalation_ticket() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  assigned integer;
begin
  if new.ticket_no is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
  select coalesce(max(ticket_no), 0) + 1
    into assigned
  from public.grm_escalations
  where workspace_id = new.workspace_id;
  new.ticket_no := assigned;
  return new;
end;
$$;


--
-- Name: grm_dashboard_bundle(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_dashboard_bundle(p_workspace_id uuid, p_client_id uuid DEFAULT NULL::uuid, p_group_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_timezone text DEFAULT 'UTC'::text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: grm_guard_location_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_guard_location_assignment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  grp public.grm_groups%rowtype;
begin
  if new.group_id is null then
    return new;
  end if;
  select * into grp from public.grm_groups where id = new.group_id;
  if grp.id is null or grp.workspace_id is distinct from new.workspace_id then
    raise exception 'That group is not in this organization';
  end if;
  if new.client_id is not null and grp.client_id is not null and grp.client_id is distinct from new.client_id then
    raise exception 'That group belongs to another brand';
  end if;
  return new;
end;
$$;


--
-- Name: grm_guard_location_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_guard_location_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  parent public.grm_location_groups%rowtype;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A group cannot be its own parent';
    end if;
    select * into parent from public.grm_location_groups where id = new.parent_id;
    if parent.id is null or parent.workspace_id is distinct from new.workspace_id then
      raise exception 'A group cannot belong to another organization';
    end if;
    if parent.parent_id is not null then
      raise exception 'A city cannot contain another group';
    end if;
    if parent.kind <> 'region' or new.kind <> 'city' then
      raise exception 'Only a city can sit under a region';
    end if;
    if parent.client_id is distinct from new.client_id then
      raise exception 'A city must belong to the same brand as its region';
    end if;
  elsif new.kind = 'city' then
    raise exception 'A city needs a region';
  end if;
  return new;
end;
$$;


--
-- Name: grm_insight_dashboard(uuid, uuid[], timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_insight_dashboard(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_analysis_version text DEFAULT 'obs-v1'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  empty_counts jsonb := jsonb_build_object(
    'discovered', 0,
    'eligible', 0,
    'alreadyAnalysed', 0,
    'ratingOnly', 0,
    'pending', 0,
    'failed', 0
  );
  counts jsonb;
  positive jsonb;
  negative jsonb;
  by_month jsonb;
  by_outlet jsonb;
  outlet_reviews jsonb;
  staff_praise jsonb;
  staff_complaints jsonb;
  severe_count integer;
  severe_incidents jsonb;
  reviews_analysed integer;
  stored_observations integer;
begin
  if p_location_ids is null or cardinality(p_location_ids) = 0 then
    return jsonb_build_object(
      'counts', empty_counts,
      'reviewsAnalysed', 0,
      'storedObservations', 0,
      'severeCount', 0,
      'positive', '[]'::jsonb,
      'negative', '[]'::jsonb,
      'byMonth', '[]'::jsonb,
      'byOutlet', '[]'::jsonb,
      'outletReviews', '{}'::jsonb,
      'staffPraise', '[]'::jsonb,
      'staffComplaints', '[]'::jsonb,
      'severeIncidents', '[]'::jsonb
    );
  end if;

  -- A ready analysis counts as current when the stored fingerprints match.
  -- Many synced reviews still have a null content_fingerprint; the stale-analysis
  -- trigger is what retires those, so a ready row with a null review fingerprint
  -- is still the current analysis.
  with scoped as (
    select
      r.id,
      (length(btrim(coalesce(r.comment, ''))) > 0) as has_text,
      r.content_fingerprint
    from public.grm_reviews r
    where r.workspace_id = p_workspace_id
      and r.location_id = any (p_location_ids)
      and r.missing_on_google_at is null
      and (p_start is null or r.review_create_time >= p_start)
      and (p_end is null or r.review_create_time < p_end)
  ),
  classified as (
    select
      s.has_text,
      (
        s.has_text
        and a.status = 'ready'
        and (
          s.content_fingerprint is null
          or a.content_fingerprint = s.content_fingerprint
        )
      ) as current_ready,
      (s.has_text and a.status = 'failed') as failed_row
    from scoped s
    left join public.grm_review_analyses a
      on a.review_id = s.id
     and a.analysis_version = p_analysis_version
  )
  select jsonb_build_object(
    'discovered', count(*)::int,
    'eligible', count(*) filter (where has_text)::int,
    'ratingOnly', count(*) filter (where not has_text)::int,
    'alreadyAnalysed', count(*) filter (where current_ready)::int,
    'pending', count(*) filter (where has_text and not coalesce(current_ready, false))::int,
    'failed', count(*) filter (where failed_row and not coalesce(current_ready, false))::int
  )
  into counts
  from classified;

  with obs as (
    select
      o.review_id,
      (
        o.sentiment = 'negative'
        and (
          coalesce(o.severity, 0) >= 4
          or o.evidence_excerpt ~* '\y(injur|hurt|bleed|blood|sick|vomit|food poison|contaminat|hair in|insect|cockroach|rat|discriminat|racist|caste|harass|abuse|threat|cheat|fraud|scam|stole|theft|police|legal|consumer court|unsafe|dangerous|allergy|hospital)\y'
        )
      ) as severe
    from public.grm_review_observations o
    join public.grm_review_analyses a
      on a.id = o.analysis_id
     and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
  )
  select
    count(*)::int,
    count(distinct review_id)::int,
    count(*) filter (where severe)::int
  into stored_observations, reviews_analysed, severe_count
  from obs;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.topic asc), '[]'::jsonb)
  into positive
  from (
    select o.topic, count(*)::int as count, count(distinct o.review_id)::int as reviews
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.sentiment = 'positive'
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by o.topic
    order by count(*) desc, o.topic asc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.topic asc), '[]'::jsonb)
  into negative
  from (
    select o.topic, count(*)::int as count, count(distinct o.review_id)::int as reviews
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.sentiment = 'negative'
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by o.topic
    order by count(*) desc, o.topic asc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.month), '[]'::jsonb)
  into by_month
  from (
    select
      to_char(o.review_create_time at time zone 'UTC', 'YYYY-MM') as month,
      count(*) filter (where o.sentiment = 'positive')::int as positive,
      count(*) filter (where o.sentiment = 'negative')::int as negative
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by 1
  ) t;

  select coalesce(
    jsonb_agg(row_to_json(t)::jsonb order by t.negative desc, t.positive desc),
    '[]'::jsonb
  )
  into by_outlet
  from (
    select
      o.location_id as "locationId",
      count(*) filter (where o.sentiment = 'positive')::int as positive,
      count(*) filter (where o.sentiment = 'negative')::int as negative,
      count(*) filter (
        where o.sentiment = 'negative'
          and (
            coalesce(o.severity, 0) >= 4
            or o.evidence_excerpt ~* '\y(injur|hurt|bleed|blood|sick|vomit|food poison|contaminat|hair in|insect|cockroach|rat|discriminat|racist|caste|harass|abuse|threat|cheat|fraud|scam|stole|theft|police|legal|consumer court|unsafe|dangerous|allergy|hospital)\y'
          )
      )::int as severe
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by o.location_id
    order by count(*) filter (where o.sentiment = 'negative') desc,
             count(*) filter (where o.sentiment = 'positive') desc
  ) t;

  select coalesce(jsonb_object_agg(location_id, n), '{}'::jsonb)
  into outlet_reviews
  from (
    select o.location_id, count(distinct o.review_id)::int as n
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by o.location_id
  ) s;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.name asc), '[]'::jsonb)
  into staff_praise
  from (
    select
      (array_agg(
        regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g')
        order by
          (regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g') <> lower(regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g'))) desc,
          regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g')
      ))[1] as name,
      count(*)::int as count
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.sentiment = 'positive'
      and o.entity_type = 'staff'
      and btrim(coalesce(o.entity_name, '')) <> ''
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by lower(regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g'))
    order by count(*) desc, name asc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.name asc), '[]'::jsonb)
  into staff_complaints
  from (
    select
      (array_agg(
        regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g')
        order by
          (regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g') <> lower(regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g'))) desc,
          regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g')
      ))[1] as name,
      count(*)::int as count
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.sentiment = 'negative'
      and o.entity_type = 'staff'
      and btrim(coalesce(o.entity_name, '')) <> ''
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    group by lower(regexp_replace(btrim(o.entity_name), '\s+', ' ', 'g'))
    order by count(*) desc, name asc
  ) t;

  select coalesce(
    jsonb_agg(
      row_to_json(t)::jsonb
      order by coalesce(t.severity, 0) desc, t."reviewCreateTime" asc
    ),
    '[]'::jsonb
  )
  into severe_incidents
  from (
    select
      o.review_id as "reviewId",
      o.severity,
      o.star_rating as "starRating",
      o.review_create_time as "reviewCreateTime",
      o.evidence_excerpt as "evidenceExcerpt",
      o.severity_rationale as "severityRationale"
    from public.grm_review_observations o
    join public.grm_review_analyses a on a.id = o.analysis_id and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.sentiment = 'negative'
      and (
        coalesce(o.severity, 0) >= 4
        or o.evidence_excerpt ~* '\y(injur|hurt|bleed|blood|sick|vomit|food poison|contaminat|hair in|insect|cockroach|rat|discriminat|racist|caste|harass|abuse|threat|cheat|fraud|scam|stole|theft|police|legal|consumer court|unsafe|dangerous|allergy|hospital)\y'
      )
      and (p_start is null or o.review_create_time >= p_start)
      and (p_end is null or o.review_create_time < p_end)
    order by coalesce(o.severity, 0) desc, o.review_create_time asc
    limit 10
  ) t;

  return jsonb_build_object(
    'counts', coalesce(counts, empty_counts),
    'reviewsAnalysed', coalesce(reviews_analysed, 0),
    'storedObservations', coalesce(stored_observations, 0),
    'severeCount', coalesce(severe_count, 0),
    'positive', coalesce(positive, '[]'::jsonb),
    'negative', coalesce(negative, '[]'::jsonb),
    'byMonth', coalesce(by_month, '[]'::jsonb),
    'byOutlet', coalesce(by_outlet, '[]'::jsonb),
    'outletReviews', coalesce(outlet_reviews, '{}'::jsonb),
    'staffPraise', coalesce(staff_praise, '[]'::jsonb),
    'staffComplaints', coalesce(staff_complaints, '[]'::jsonb),
    'severeIncidents', coalesce(severe_incidents, '[]'::jsonb)
  );
end;
$$;


--
-- Name: FUNCTION grm_insight_dashboard(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_analysis_version text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_insight_dashboard(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_analysis_version text) IS 'Counts and chart aggregates for the insights page. Replaces downloading every review and observation into the app server.';


--
-- Name: grm_location_in_group(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_location_in_group(p_group_id uuid, p_selected uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select p_selected is null
    or p_group_id = p_selected
    or exists (
      select 1 from public.grm_groups g
      where g.id = p_group_id and g.parent_id = p_selected
    );
$$;


--
-- Name: grm_location_review_counts(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_location_review_counts(p_workspace_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(location_id uuid, review_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select r.location_id, count(*)::int
  from public.grm_reviews r
  where r.workspace_id = p_workspace_id
    and r.missing_on_google_at is null
    and (p_start is null or r.review_create_time >= p_start)
    and (p_end is null or r.review_create_time < p_end)
  group by r.location_id;
$$;


--
-- Name: grm_location_review_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_location_review_stats(p_workspace_id uuid) RETURNS TABLE(location_id uuid, review_count integer, unanswered integer, drafts integer, approved integer, failed integer, published integer, critical integer, rating_sum bigint, r1 integer, r2 integer, r3 integer, r4 integer, r5 integer, last_7d integer, last_30d integer, last_review_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: grm_mark_review_analysis_stale(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_mark_review_analysis_stale() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.content_fingerprint is distinct from old.content_fingerprint
     or new.comment is distinct from old.comment
     or new.star_rating is distinct from old.star_rating then
    update public.grm_review_analyses
      set status = 'stale', updated_at = now()
      where review_id = new.id
        and status in ('ready', 'no_text')
        and content_fingerprint is distinct from coalesce(new.content_fingerprint, '');
  end if;
  return new;
end;
$$;


--
-- Name: grm_overview_signals(uuid, uuid[], timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_overview_signals(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recent_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recent_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_now timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION grm_overview_signals(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_recent_start timestamp with time zone, p_recent_end timestamp with time zone, p_now timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_overview_signals(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_recent_start timestamp with time zone, p_recent_end timestamp with time zone, p_now timestamp with time zone) IS 'Top negative insight topic per outlet, busiest recent 1–3 star outlet, and oldest overdue escalation for the overview page.';


--
-- Name: grm_record_ai_usage(uuid, uuid, text, text, text, bigint, bigint, numeric, boolean, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_record_ai_usage(p_event_id uuid, p_workspace_id uuid, p_month text, p_operation text, p_model text, p_input_tokens bigint, p_output_tokens bigint, p_estimated_usd numeric, p_usage_known boolean, p_status text, p_calls integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  insert into public.grm_ai_call_events (id, workspace_id, operation, model, input_tokens, output_tokens, estimated_usd, usage_known, status)
  values (p_event_id, p_workspace_id, p_operation, p_model, p_input_tokens, p_output_tokens, p_estimated_usd, p_usage_known, p_status)
  on conflict (id) do nothing;
  if not found then return; end if;
  insert into public.grm_ai_usage_monthly (workspace_id, month, operation, calls, input_tokens, output_tokens, estimated_usd)
  values (p_workspace_id, p_month, p_operation, p_calls, p_input_tokens, p_output_tokens, p_estimated_usd)
  on conflict (workspace_id, month, operation) do update set
    calls = public.grm_ai_usage_monthly.calls + excluded.calls,
    input_tokens = public.grm_ai_usage_monthly.input_tokens + excluded.input_tokens,
    output_tokens = public.grm_ai_usage_monthly.output_tokens + excluded.output_tokens,
    estimated_usd = public.grm_ai_usage_monthly.estimated_usd + excluded.estimated_usd,
    updated_at = now();
end;
$$;


--
-- Name: grm_request_board(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_request_board(p_workspace uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'sent', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and accepted_at is not null),
    'delivered', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and delivered_at is not null),
    'opened', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and opened_at is not null),
    'message_clicks', (select count(*) from public.grm_request_messages where workspace_id = p_workspace and is_test = false and clicked_at is not null),
    'scans', (select count(*) from public.grm_request_events where workspace_id = p_workspace and kind = 'scan'),
    'feedback', (select count(*) from public.grm_request_feedback where workspace_id = p_workspace),
    'opted_out', (select count(*) from public.grm_request_customers where workspace_id = p_workspace and opted_out_at is not null),
    'campaigns', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
      from (
        select
          camp.id,
          camp.name,
          camp.channel,
          camp.status,
          camp.language,
          camp.source,
          camp.created_at,
          camp.sent_at,
          camp.reminder_enabled,
          camp.preview_eligible,
          camp.preview_suppressed,
          camp.preview_opted_out,
          camp.preview_missing_contact,
          camp.preview_unknown_store,
          camp.preview_duplicates,
          (select count(*) from public.grm_request_campaign_locations cl where cl.campaign_id = camp.id) as locations,
          (select coalesce(jsonb_agg(cl.location_id), '[]'::jsonb) from public.grm_request_campaign_locations cl where cl.campaign_id = camp.id) as location_ids,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.accepted_at is not null) as sent,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.delivered_at is not null) as delivered,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.opened_at is not null) as opened,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'failed') as failed,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'queued') as queued,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'unavailable') as unavailable,
          (select count(*) from public.grm_request_messages m where m.campaign_id = camp.id and m.is_test = false and m.status = 'suppressed') as suppressed,
          (select m.error from public.grm_request_messages m where m.campaign_id = camp.id and m.error is not null order by m.created_at desc limit 1) as last_error
        from public.grm_request_campaigns camp
        where camp.workspace_id = p_workspace
      ) c
    ),
    'qr', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
      from (
        select
          qr.location_id,
          qr.token,
          qr.language,
          (select count(*) from public.grm_request_events e where e.qr_id = qr.id and e.kind = 'scan') as scans,
          (select count(*) from public.grm_request_feedback f where f.qr_id = qr.id) as feedback
        from public.grm_request_qr qr
        where qr.workspace_id = p_workspace
      ) q
    )
  );
$$;


--
-- Name: grm_review_trends(uuid, integer, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_review_trends(p_workspace_id uuid, p_months integer DEFAULT 12, p_client_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(month date, review_count integer, avg_rating numeric, negative integer, positive integer, replied integer, avg_response_hours numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: grm_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: FUNCTION grm_set_updated_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_set_updated_at() IS 'Automatically stamps updated_at on every UPDATE.';


--
-- Name: grm_shell_profile_attention(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_shell_profile_attention(p_workspace_id uuid, p_location_ids uuid[]) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with rev as (
    select
      r.location_id,
      count(*) filter (where r.reply_status = 'none')::int as unreplied,
      count(*) filter (where r.reply_status = 'draft')::int as drafts,
      count(*) filter (where r.reply_status = 'failed')::int as failed
    from public.grm_reviews r
    where r.workspace_id = p_workspace_id
      and r.location_id = any (p_location_ids)
      and r.missing_on_google_at is null
      and r.reply_status in ('none', 'draft', 'failed')
    group by r.location_id
  ),
  esc as (
    select
      e.location_id,
      count(*)::int as escalations
    from public.grm_escalations e
    where e.workspace_id = p_workspace_id
      and e.location_id = any (p_location_ids)
      and e.status <> 'resolved'
    group by e.location_id
  ),
  combined as (
    select
      coalesce(rev.location_id, esc.location_id) as location_id,
      coalesce(rev.unreplied, 0) as unreplied,
      coalesce(rev.drafts, 0) as drafts,
      coalesce(rev.failed, 0) as failed,
      coalesce(esc.escalations, 0) as escalations
    from rev
    full outer join esc on esc.location_id = rev.location_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'locationId', location_id,
        'unreplied', unreplied,
        'drafts', drafts,
        'failed', failed,
        'escalations', escalations
      )
      order by escalations desc, failed desc, unreplied desc, drafts desc
    ),
    '[]'::jsonb
  )
  from combined
  where unreplied + drafts + failed + escalations > 0;
$$;


--
-- Name: FUNCTION grm_shell_profile_attention(p_workspace_id uuid, p_location_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_shell_profile_attention(p_workspace_id uuid, p_location_ids uuid[]) IS 'Per-location attention counts for the dashboard sidebar. Replaces downloading review/escalation rows to count them in the app.';


--
-- Name: grm_star_breakdown(uuid, uuid[], timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grm_star_breakdown(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_timezone text DEFAULT 'UTC'::text) RETURNS TABLE(month date, location_id uuid, star_rating integer, complaint_theme text, review_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION grm_star_breakdown(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_timezone text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.grm_star_breakdown(p_workspace_id uuid, p_location_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_timezone text) IS 'Star-rating counts per month (workspace timezone) / location / theme for dashboard charts. Replaces downloading review rows to count them in the app.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: authn; Owner: -
--

CREATE TABLE authn.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at bigint,
    token_type text,
    scope text,
    id_token text,
    session_state text
);


--
-- Name: sessions; Type: TABLE; Schema: authn; Owner: -
--

CREATE TABLE authn.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "sessionToken" text NOT NULL,
    "userId" uuid NOT NULL,
    expires timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: authn; Owner: -
--

CREATE TABLE authn.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    email text NOT NULL,
    "emailVerified" timestamp with time zone,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sign_in_at timestamp with time zone
);


--
-- Name: verification_token; Type: TABLE; Schema: authn; Owner: -
--

CREATE TABLE authn.verification_token (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp with time zone NOT NULL
);


--
-- Name: grm_access_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    user_id uuid,
    company text,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_access_requests_company_check CHECK (((company IS NULL) OR (char_length(company) <= 255))),
    CONSTRAINT grm_access_requests_email_check CHECK (((email = lower(email)) AND (email ~~ '%@%'::text))),
    CONSTRAINT grm_access_requests_message_check CHECK (((message IS NULL) OR (char_length(message) <= 1000))),
    CONSTRAINT grm_access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);


--
-- Name: TABLE grm_access_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_access_requests IS 'Request-access submissions from the invite-only gate. Approving creates a platform tenant invite.';


--
-- Name: grm_agency_branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_agency_branding (
    workspace_id uuid NOT NULL,
    logo_url text,
    hide_product_name boolean DEFAULT false NOT NULL,
    custom_domain text,
    domain_token text,
    domain_verified_at timestamp with time zone,
    sender_email text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_ai_call_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_ai_call_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    operation text NOT NULL,
    model text NOT NULL,
    input_tokens bigint NOT NULL,
    output_tokens bigint NOT NULL,
    estimated_usd numeric(16,8) NOT NULL,
    usage_known boolean NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_ai_call_events_estimated_usd_check CHECK ((estimated_usd >= (0)::numeric)),
    CONSTRAINT grm_ai_call_events_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT grm_ai_call_events_output_tokens_check CHECK ((output_tokens >= 0))
);


--
-- Name: grm_ai_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_ai_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    status text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_ai_configs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: TABLE grm_ai_configs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_ai_configs IS 'Versioned workspace AI configuration snapshots. Active row is used for reply drafting.';


--
-- Name: grm_ai_generation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_ai_generation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    review_id uuid,
    location_id uuid,
    scope_kind text,
    scope_id uuid,
    model text NOT NULL,
    route text,
    content text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'generated'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    draft_id uuid,
    reply_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_ai_generation_jobs_kind_check CHECK ((kind = 'reply'::text)),
    CONSTRAINT grm_ai_generation_jobs_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['client'::text, 'group'::text]))),
    CONSTRAINT grm_ai_generation_jobs_status_check CHECK ((status = ANY (ARRAY['generated'::text, 'persisting'::text, 'saved'::text, 'failed'::text, 'superseded'::text])))
);


--
-- Name: TABLE grm_ai_generation_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_ai_generation_jobs IS 'AI generation outbox: generated content lands here first, background persister saves it into place.';


--
-- Name: grm_ai_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_ai_knowledge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_ai_knowledge_check CHECK ((((client_id IS NULL) AND (group_id IS NULL) AND (location_id IS NULL)) OR ((client_id IS NOT NULL) AND (group_id IS NULL) AND (location_id IS NULL)) OR ((client_id IS NULL) AND (group_id IS NOT NULL) AND (location_id IS NULL)) OR ((client_id IS NULL) AND (group_id IS NULL) AND (location_id IS NOT NULL)))),
    CONSTRAINT grm_ai_knowledge_kind_check CHECK ((kind = ANY (ARRAY['instruction'::text, 'faq'::text, 'response_rule'::text, 'approved_example'::text])))
);


--
-- Name: TABLE grm_ai_knowledge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_ai_knowledge IS 'Structured tenant knowledge: instructions, FAQs, response rules, and approved examples.';


--
-- Name: grm_ai_usage_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_ai_usage_monthly (
    workspace_id uuid NOT NULL,
    month text NOT NULL,
    operation text NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    estimated_usd numeric(12,6) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_ai_usage_monthly_calls_check CHECK ((calls >= 0)),
    CONSTRAINT grm_ai_usage_monthly_estimated_usd_check CHECK ((estimated_usd >= (0)::numeric)),
    CONSTRAINT grm_ai_usage_monthly_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT grm_ai_usage_monthly_month_check CHECK ((month ~ '^\d{4}-\d{2}$'::text)),
    CONSTRAINT grm_ai_usage_monthly_operation_check CHECK ((operation = ANY (ARRAY['extract_review'::text, 'extract_batch'::text, 'embed_review'::text, 'insight_prose'::text, 'reply_draft'::text, 'insight_brief'::text, 'insight_deep_dive'::text, 'preview'::text]))),
    CONSTRAINT grm_ai_usage_monthly_output_tokens_check CHECK ((output_tokens >= 0))
);


--
-- Name: TABLE grm_ai_usage_monthly; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_ai_usage_monthly IS 'Estimated Gemini spend by month. Costs are computed from usageMetadata at published prices, not a provider invoice. The service role writes; members may read their workspace rows.';


--
-- Name: grm_alert_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_alert_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    status text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_alert_deliveries_status_check CHECK ((status = ANY (ARRAY['recorded'::text, 'sent'::text, 'failed'::text, 'unavailable'::text])))
);


--
-- Name: grm_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_alert_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    summary text NOT NULL,
    fingerprint text NOT NULL,
    delivery text DEFAULT 'recorded'::text NOT NULL,
    dedupe_key text,
    location_id uuid,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN grm_alert_events.fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_alert_events.fingerprint IS 'Unique with the workspace. New alerts set this to the rule id plus the dedupe key.';


--
-- Name: grm_alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_alert_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    channel text DEFAULT 'in_app'::text NOT NULL,
    scope_label text,
    notify_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'connection_expired'::text NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    recipient_emails text[] DEFAULT '{}'::text[] NOT NULL,
    channels text[] DEFAULT '{in_app}'::text[] NOT NULL,
    threshold integer DEFAULT 3 NOT NULL,
    window_days integer DEFAULT 1 NOT NULL,
    min_reviews integer DEFAULT 5 NOT NULL,
    drop_points numeric DEFAULT 0.5 NOT NULL,
    multiplier numeric DEFAULT 2 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: grm_analysis_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_analysis_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by uuid,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    range_start timestamp with time zone,
    range_end timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    discovered integer DEFAULT 0 NOT NULL,
    eligible integer DEFAULT 0 NOT NULL,
    already_analysed integer DEFAULT 0 NOT NULL,
    newly_analysed integer DEFAULT 0 NOT NULL,
    pending integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    batches_total integer DEFAULT 0 NOT NULL,
    batches_completed integer DEFAULT 0 NOT NULL,
    retries integer DEFAULT 0 NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_analysis_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: grm_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_audit_logs_action_check CHECK ((char_length(action) >= 1)),
    CONSTRAINT grm_audit_logs_entity_type_check CHECK ((char_length(entity_type) >= 1))
);


--
-- Name: TABLE grm_audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_audit_logs IS 'Immutable audit trail. No UPDATE or DELETE RLS policies are defined.';


--
-- Name: grm_autoreply_pauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_autoreply_pauses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    scope text NOT NULL,
    client_id uuid,
    location_id uuid,
    paused_by uuid NOT NULL,
    paused_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_at timestamp with time zone,
    CONSTRAINT grm_autoreply_pauses_check CHECK ((((scope = 'workspace'::text) AND (client_id IS NULL) AND (location_id IS NULL)) OR ((scope = 'client'::text) AND (client_id IS NOT NULL) AND (location_id IS NULL)) OR ((scope = 'location'::text) AND (location_id IS NOT NULL) AND (client_id IS NULL)))),
    CONSTRAINT grm_autoreply_pauses_scope_check CHECK ((scope = ANY (ARRAY['workspace'::text, 'client'::text, 'location'::text])))
);


--
-- Name: grm_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    CONSTRAINT grm_brands_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 160)))
);


--
-- Name: grm_bulk_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_bulk_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    review_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    results jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    succeeded integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_bulk_jobs_action_check CHECK ((action = ANY (ARRAY['generate'::text, 'publish'::text]))),
    CONSTRAINT grm_bulk_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: TABLE grm_bulk_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_bulk_jobs IS 'Bulk reply action queue: request enqueues, background worker processes with bounded concurrency, clients poll for results.';


--
-- Name: grm_client_onboarding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_client_onboarding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_email text,
    website text,
    account_manager_user_id uuid,
    brand_name text,
    logo_url text,
    CONSTRAINT grm_clients_brand_name_check CHECK (((brand_name IS NULL) OR ((char_length(brand_name) >= 1) AND (char_length(brand_name) <= 80)))),
    CONSTRAINT grm_clients_contact_email_check CHECK (((contact_email IS NULL) OR ((POSITION(('@'::text) IN (contact_email)) > 1) AND (char_length(contact_email) <= 200)))),
    CONSTRAINT grm_clients_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 255)))
);


--
-- Name: TABLE grm_clients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_clients IS 'Business entity whose Google reviews the workspace is managing.';


--
-- Name: grm_escalation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_escalation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    escalation_id uuid NOT NULL,
    kind text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: grm_escalation_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_escalation_policies (
    workspace_id uuid NOT NULL,
    max_stars integer DEFAULT 3 NOT NULL,
    flag_profanity boolean DEFAULT true NOT NULL,
    flag_legal_safety boolean DEFAULT true NOT NULL,
    extra_keywords text[] DEFAULT '{}'::text[] NOT NULL,
    reminder_hours integer[] DEFAULT '{2,6}'::integer[] NOT NULL,
    due_hours integer DEFAULT 24 NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolution_phone text,
    resolution_email text,
    CONSTRAINT grm_escalation_policies_due_hours_check CHECK (((due_hours >= 1) AND (due_hours <= 168))),
    CONSTRAINT grm_escalation_policies_max_stars_check CHECK (((max_stars >= 1) AND (max_stars <= 5))),
    CONSTRAINT grm_escalation_policies_resolution_email_check CHECK (((resolution_email IS NULL) OR ((char_length(resolution_email) >= 3) AND (char_length(resolution_email) <= 320)))),
    CONSTRAINT grm_escalation_policies_resolution_phone_check CHECK (((resolution_phone IS NULL) OR ((char_length(resolution_phone) >= 6) AND (char_length(resolution_phone) <= 40))))
);


--
-- Name: TABLE grm_escalation_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_escalation_policies IS 'Configurable complaint rules. Defaults match a 3-star threshold, reminders at 2 and 6 hours, and a 24-hour due time.';


--
-- Name: COLUMN grm_escalation_policies.resolution_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_escalation_policies.resolution_phone IS 'Organisation phone a person can insert into an escalation reply. Nothing inserts it automatically.';


--
-- Name: COLUMN grm_escalation_policies.resolution_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_escalation_policies.resolution_email IS 'Organisation email a person can insert into an escalation reply. Nothing inserts it automatically.';


--
-- Name: grm_escalation_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_escalation_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    escalation_id uuid NOT NULL,
    kind text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT grm_escalation_reminders_attempts_check CHECK ((attempts >= 0))
);


--
-- Name: TABLE grm_escalation_reminders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_escalation_reminders IS 'In-app SLA reminders. sent_at means the reminder was recorded in GRM, not that an email or message was delivered.';


--
-- Name: grm_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    review_id uuid NOT NULL,
    location_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    theme text,
    assignee_user_id uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    resolution_code text,
    internal_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    level text DEFAULT 'store'::text NOT NULL,
    resolved_by uuid,
    trigger_reasons text[] DEFAULT '{recorded}'::text[] NOT NULL,
    trigger_key text NOT NULL,
    responsible_user_id uuid,
    ownership text DEFAULT 'fallback'::text NOT NULL,
    assignment_reason text,
    assignment_decided_at timestamp with time zone,
    sla_advanced_at timestamp with time zone,
    ticket_no integer NOT NULL,
    CONSTRAINT grm_escalations_level_check CHECK ((level = ANY (ARRAY['store'::text, 'regional'::text, 'leadership'::text]))),
    CONSTRAINT grm_escalations_ownership_check CHECK ((ownership = ANY (ARRAY['manager'::text, 'fallback'::text]))),
    CONSTRAINT grm_escalations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: COLUMN grm_escalations.ticket_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_escalations.ticket_no IS 'Organisation-local case number. Shown as ESC-{ticket_no}.';


--
-- Name: grm_google_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_google_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    google_account_name text NOT NULL,
    account_display_name text NOT NULL,
    account_type text NOT NULL,
    verification_state text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE grm_google_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_google_accounts IS 'Google Business Profile account, discovered via the Account Management API.';


--
-- Name: COLUMN grm_google_accounts.google_account_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_accounts.google_account_name IS 'Google resource name, e.g. "accounts/123456789". Used as external identifier.';


--
-- Name: grm_google_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_google_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    authorized_by_user_id uuid NOT NULL,
    google_email text NOT NULL,
    access_token_enc text NOT NULL,
    refresh_token_enc text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status public.grm_connection_status DEFAULT 'active'::public.grm_connection_status NOT NULL,
    last_refreshed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid
);


--
-- Name: TABLE grm_google_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_google_connections IS 'OAuth 2.0 connection to a Google account. Tokens are encrypted at rest.';


--
-- Name: COLUMN grm_google_connections.access_token_enc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_connections.access_token_enc IS 'AES-256-GCM encrypted access token. Never expose via RLS select policies.';


--
-- Name: COLUMN grm_google_connections.refresh_token_enc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_connections.refresh_token_enc IS 'AES-256-GCM encrypted refresh token. Never expose via RLS select policies.';


--
-- Name: grm_google_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_google_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid,
    google_account_id uuid NOT NULL,
    google_location_name text NOT NULL,
    location_title text NOT NULL,
    store_code text,
    address_formatted text,
    primary_phone text,
    website_uri text,
    place_id text,
    is_active boolean DEFAULT true NOT NULL,
    last_synced_at timestamp with time zone,
    sync_cursor text,
    total_review_count integer,
    average_rating numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    group_id uuid,
    voice_of_merchant boolean,
    google_duplicate_of text,
    hold_reason text,
    sync_status public.grm_sync_status DEFAULT 'idle'::public.grm_sync_status NOT NULL,
    sync_started_at timestamp with time zone,
    sync_completed_at timestamp with time zone,
    sync_error text,
    reviews_full_synced_at timestamp with time zone,
    CONSTRAINT grm_google_locations_average_rating_check CHECK (((average_rating >= (0)::numeric) AND (average_rating <= (5)::numeric))),
    CONSTRAINT grm_google_locations_hold_reason_check CHECK (((hold_reason IS NULL) OR (hold_reason = ANY (ARRAY['duplicate'::text, 'unverified'::text])))),
    CONSTRAINT grm_google_locations_total_review_count_check CHECK ((total_review_count >= 0))
);


--
-- Name: TABLE grm_google_locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_google_locations IS 'Google Business Profile location linked to a client. Reviews are synced per location.';


--
-- Name: COLUMN grm_google_locations.client_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.client_id IS 'Nullable: null means discovered from Google but not yet assigned to a client.';


--
-- Name: COLUMN grm_google_locations.google_location_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.google_location_name IS 'Google resource name, e.g. "accounts/123/locations/456". External identifier.';


--
-- Name: COLUMN grm_google_locations.sync_cursor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.sync_cursor IS 'Stores nextPageToken from last sync for resumable pagination.';


--
-- Name: COLUMN grm_google_locations.total_review_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.total_review_count IS 'Review total reported by Google (listReviews totalReviewCount) at the last sync. Compare with the local grm_reviews count to detect sync gaps.';


--
-- Name: COLUMN grm_google_locations.voice_of_merchant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.voice_of_merchant IS 'Google hasVoiceOfMerchant. Null means Google has not returned it yet.';


--
-- Name: COLUMN grm_google_locations.hold_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.hold_reason IS 'Blocks automatic grouping and AI drafts. Manual replies stay available.';


--
-- Name: COLUMN grm_google_locations.sync_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.sync_status IS 'Outcome of the last review sync for this location. A sync that stopped before reading every page (incremental cap, page failure) is partial, never success.';


--
-- Name: COLUMN grm_google_locations.reviews_full_synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_google_locations.reviews_full_synced_at IS 'When a full review crawl last finished every page without a provider or storage failure. Null means the location has never been fully crawled and the next sync must run in full mode.';


--
-- Name: grm_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    kind text DEFAULT 'region'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT grm_groups_kind_check CHECK ((kind = ANY (ARRAY['region'::text, 'city'::text]))),
    CONSTRAINT grm_groups_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: grm_insight_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_insight_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    cache_key text NOT NULL,
    requested_by uuid,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    location_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    range_start timestamp with time zone,
    range_end timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    phase text,
    insights jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    limitations jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_fingerprint text,
    analysis_version text NOT NULL,
    prompt_version text NOT NULL,
    model text,
    discovered_count integer DEFAULT 0 NOT NULL,
    eligible_count integer DEFAULT 0 NOT NULL,
    analysed_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    pending_count integer DEFAULT 0 NOT NULL,
    failed_review_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_insight_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: grm_location_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_location_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    parent_id uuid,
    kind text DEFAULT 'region'::text NOT NULL,
    CONSTRAINT grm_location_groups_kind_check CHECK ((kind = ANY (ARRAY['region'::text, 'city'::text]))),
    CONSTRAINT grm_location_groups_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT grm_location_groups_source_check CHECK ((source = ANY (ARRAY['state_city'::text, 'city'::text, 'account'::text, 'manual'::text, 'csv'::text])))
);


--
-- Name: TABLE grm_location_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_location_groups IS 'Named groups of Google locations inside a workspace. Clients stay the parent record.';


--
-- Name: grm_location_managers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_location_managers (
    location_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: grm_location_tag_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_location_tag_links (
    location_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: grm_location_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_location_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_location_tags_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40)))
);


--
-- Name: grm_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    location_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    href text NOT NULL,
    dedupe_key text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_notifications_kind_check CHECK ((kind = ANY (ARRAY['new_reviews'::text, 'escalation_assigned'::text, 'sla_reminder'::text, 'publish_failed'::text])))
);


--
-- Name: grm_onboarding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_onboarding (
    workspace_id uuid NOT NULL,
    step text DEFAULT 'connect'::text NOT NULL,
    "grouping" text,
    tone_voice text,
    tone_note text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_onboarding_grouping_check CHECK ((("grouping" IS NULL) OR ("grouping" = ANY (ARRAY['state_city'::text, 'city'::text, 'account'::text, 'none'::text, 'csv'::text])))),
    CONSTRAINT grm_onboarding_step_check CHECK ((step = ANY (ARRAY['connect'::text, 'import'::text, 'groups'::text, 'tone'::text, 'invite'::text, 'done'::text]))),
    CONSTRAINT grm_onboarding_tone_note_check CHECK (((tone_note IS NULL) OR (char_length(tone_note) <= 500))),
    CONSTRAINT grm_onboarding_tone_voice_check CHECK (((tone_voice IS NULL) OR (tone_voice = ANY (ARRAY['warm'::text, 'professional'::text, 'brief'::text]))))
);


--
-- Name: TABLE grm_onboarding; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_onboarding IS 'Saved setup progress so a workspace can leave and resume the wizard.';


--
-- Name: grm_platform_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_platform_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    tone text DEFAULT 'info'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_platform_announcements_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000))),
    CONSTRAINT grm_platform_announcements_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200))),
    CONSTRAINT grm_platform_announcements_tone_check CHECK ((tone = ANY (ARRAY['info'::text, 'warning'::text])))
);


--
-- Name: grm_platform_blocked_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_platform_blocked_users (
    email text NOT NULL,
    user_id uuid,
    reason text,
    blocked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_platform_blocked_users_email_check CHECK (((email = lower(email)) AND (email ~~ '%@%'::text))),
    CONSTRAINT grm_platform_blocked_users_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 500)))
);


--
-- Name: TABLE grm_platform_blocked_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_platform_blocked_users IS 'Platform-wide login block by email. Checked at the tenant gate; tenant memberships are kept.';


--
-- Name: grm_platform_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_platform_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    invited_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    workspace_id uuid,
    accepted_user_id uuid,
    note text,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_platform_invites_email_check CHECK (((email = lower(email)) AND (char_length(email) >= 3) AND (char_length(email) <= 320) AND (email ~~ '%@%'::text))),
    CONSTRAINT grm_platform_invites_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT grm_platform_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: TABLE grm_platform_invites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_platform_invites IS 'Platform (super-admin) invite for one tenant owner email. One invite creates one workspace when that exact email signs in with Google and names the tenant. No email is sent by this migration.';


--
-- Name: grm_platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_platform_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE grm_platform_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_platform_settings IS 'Platform key/value settings, e.g. maintenance mode. Service-role only.';


--
-- Name: grm_reply_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_reply_settings (
    workspace_id uuid NOT NULL,
    tone jsonb DEFAULT '{}'::jsonb NOT NULL,
    automation jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_reply_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_reply_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_reply_templates_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000))),
    CONSTRAINT grm_reply_templates_check CHECK ((((
CASE
    WHEN (client_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (group_id IS NULL) THEN 0
    ELSE 1
END) +
CASE
    WHEN (location_id IS NULL) THEN 0
    ELSE 1
END) <= 1)),
    CONSTRAINT grm_reply_templates_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: grm_report_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_report_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    status text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_report_deliveries_status_check CHECK ((status = ANY (ARRAY['recorded'::text, 'sent'::text, 'failed'::text, 'unavailable'::text])))
);


--
-- Name: grm_report_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_report_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    schedule_id uuid,
    trigger text NOT NULL,
    slot timestamp with time zone,
    status text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    summary text,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT grm_report_runs_attempts_check CHECK ((attempts >= 1)),
    CONSTRAINT grm_report_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'delivered'::text, 'failed'::text, 'skipped'::text]))),
    CONSTRAINT grm_report_runs_trigger_check CHECK ((trigger = ANY (ARRAY['schedule'::text, 'test'::text])))
);


--
-- Name: grm_report_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    frequency text NOT NULL,
    recipients text DEFAULT ''::text NOT NULL,
    channel text DEFAULT 'in_app'::text NOT NULL,
    scope_label text,
    include_scorecard boolean DEFAULT true NOT NULL,
    include_leaderboard boolean DEFAULT true NOT NULL,
    include_themes boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    sections text[] DEFAULT '{scorecard,trends,leaderboard,themes}'::text[] NOT NULL,
    delivery_time text DEFAULT '09:00'::text NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    weekday smallint,
    day_of_month smallint,
    recipient_emails text[] DEFAULT '{}'::text[] NOT NULL,
    channels text[] DEFAULT '{in_app}'::text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT grm_report_schedules_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
);


--
-- Name: COLUMN grm_report_schedules.channels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_report_schedules.channels IS 'in_app is stored in GRM. email, slack, and whatsapp are attempted only when that provider is configured.';


--
-- Name: grm_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    sections text[] DEFAULT '{scorecard,trends,leaderboard,themes}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_request_campaign_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_campaign_locations (
    campaign_id uuid NOT NULL,
    location_id uuid NOT NULL
);


--
-- Name: grm_request_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    channel text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    template text DEFAULT ''::text NOT NULL,
    reminder_enabled boolean DEFAULT false NOT NULL,
    reminder_after_days integer DEFAULT 3 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    source text DEFAULT 'csv'::text NOT NULL,
    preview_eligible integer DEFAULT 0 NOT NULL,
    preview_suppressed integer DEFAULT 0 NOT NULL,
    preview_opted_out integer DEFAULT 0 NOT NULL,
    preview_missing_contact integer DEFAULT 0 NOT NULL,
    preview_unknown_store integer DEFAULT 0 NOT NULL,
    preview_duplicates integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT grm_request_campaigns_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'qr'::text]))),
    CONSTRAINT grm_request_campaigns_reminder_after_days_check CHECK (((reminder_after_days >= 1) AND (reminder_after_days <= 30))),
    CONSTRAINT grm_request_campaigns_source_check CHECK ((source = ANY (ARRAY['csv'::text, 'qr'::text]))),
    CONSTRAINT grm_request_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: grm_request_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    email text,
    phone text,
    phone_key text,
    location_id uuid,
    dedupe_key text NOT NULL,
    opted_out_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_request_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    message_id uuid,
    qr_id uuid,
    kind text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_request_events_kind_check CHECK ((kind = ANY (ARRAY['accepted'::text, 'delivered'::text, 'opened'::text, 'clicked'::text, 'google_click'::text, 'feedback'::text, 'failed'::text, 'opted_out'::text, 'scan'::text])))
);


--
-- Name: grm_request_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    location_id uuid,
    message_id uuid,
    qr_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_request_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    campaign_id uuid,
    customer_id uuid,
    location_id uuid,
    channel text NOT NULL,
    token text NOT NULL,
    status text NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    is_reminder boolean DEFAULT false NOT NULL,
    reminder_of uuid,
    attempts integer DEFAULT 0 NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    provider_ref text,
    error text,
    queued_at timestamp with time zone,
    accepted_at timestamp with time zone,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    google_clicked_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_request_messages_status_check CHECK ((status = ANY (ARRAY['suppressed'::text, 'opted_out'::text, 'unavailable'::text, 'queued'::text, 'accepted'::text, 'failed'::text, 'delivered'::text])))
);


--
-- Name: grm_request_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_policies (
    workspace_id uuid NOT NULL,
    cooldown_days integer DEFAULT 90 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_request_policies_cooldown_days_check CHECK (((cooldown_days >= 1) AND (cooldown_days <= 365)))
);


--
-- Name: grm_request_qr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_qr (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    location_id uuid NOT NULL,
    token text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grm_request_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_request_recipients (
    campaign_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    location_id uuid,
    decision text NOT NULL,
    CONSTRAINT grm_request_recipients_decision_check CHECK ((decision = ANY (ARRAY['eligible'::text, 'suppressed'::text, 'opted_out'::text])))
);


--
-- Name: grm_review_ai_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_review_ai_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    review_id uuid NOT NULL,
    content text NOT NULL,
    ai_model text NOT NULL,
    ai_prompt_hash text NOT NULL,
    prompt_version text NOT NULL,
    generation_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.grm_ai_draft_status DEFAULT 'generated'::public.grm_ai_draft_status NOT NULL,
    edited_content text,
    edited_at timestamp with time zone,
    edited_by uuid,
    generated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_config_version integer,
    generation_id uuid,
    CONSTRAINT grm_review_ai_drafts_content_check CHECK ((char_length(content) >= 1))
);


--
-- Name: TABLE grm_review_ai_drafts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_review_ai_drafts IS 'AI-generated reply candidates. Full generation history is preserved.';


--
-- Name: grm_review_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_review_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    review_id uuid NOT NULL,
    location_id uuid NOT NULL,
    analysis_version text NOT NULL,
    content_fingerprint text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    model text,
    observation_count integer DEFAULT 0 NOT NULL,
    error text,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_review_analyses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'stale'::text, 'no_text'::text])))
);


--
-- Name: grm_review_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_review_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    review_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_review_notes_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)))
);


--
-- Name: TABLE grm_review_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_review_notes IS 'Internal notes on a review. They are not published to Google.';


--
-- Name: grm_review_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_review_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    review_id uuid NOT NULL,
    location_id uuid NOT NULL,
    client_id uuid,
    group_id uuid,
    review_create_time timestamp with time zone NOT NULL,
    star_rating smallint NOT NULL,
    language text,
    topic text NOT NULL,
    subtopic text,
    sentiment text NOT NULL,
    detail text NOT NULL,
    entity_type text,
    entity_name text,
    severity smallint,
    severity_rationale text,
    evidence_excerpt text NOT NULL,
    evidence_start integer,
    evidence_end integer,
    basis text DEFAULT 'fact'::text NOT NULL,
    confidence numeric(3,2),
    is_ambiguous boolean DEFAULT false NOT NULL,
    dedupe_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_review_observations_basis_check CHECK ((basis = ANY (ARRAY['fact'::text, 'hypothesis'::text]))),
    CONSTRAINT grm_review_observations_entity_check CHECK (((entity_type IS NULL) OR (entity_type = ANY (ARRAY['staff'::text, 'product'::text, 'clothing_category'::text, 'outlet'::text, 'service'::text, 'billing'::text, 'refund'::text, 'price'::text, 'facility'::text, 'other'::text])))),
    CONSTRAINT grm_review_observations_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'negative'::text, 'neutral'::text, 'mixed'::text]))),
    CONSTRAINT grm_review_observations_severity_check CHECK (((severity IS NULL) OR ((severity >= 1) AND (severity <= 5)))),
    CONSTRAINT grm_review_observations_stars_check CHECK (((star_rating >= 1) AND (star_rating <= 5)))
);


--
-- Name: grm_review_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_review_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    review_id uuid NOT NULL,
    ai_draft_id uuid,
    content text NOT NULL,
    source public.grm_reply_source NOT NULL,
    status public.grm_reply_pub_status DEFAULT 'draft'::public.grm_reply_pub_status NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    published_at timestamp with time zone,
    published_by uuid,
    last_error text,
    failure_count smallint DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    publish_result jsonb,
    client_approval text DEFAULT 'none'::text NOT NULL,
    CONSTRAINT grm_review_replies_client_approval_check CHECK ((client_approval = ANY (ARRAY['none'::text, 'requested'::text, 'approved'::text]))),
    CONSTRAINT grm_review_replies_content_check CHECK ((char_length(content) >= 1)),
    CONSTRAINT grm_review_replies_failure_count_check CHECK ((failure_count >= 0))
);


--
-- Name: TABLE grm_review_replies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_review_replies IS 'Reply lifecycle for a review: draft → approved → pending_publish → published.';


--
-- Name: COLUMN grm_review_replies.publish_result; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_review_replies.publish_result IS 'The reply object returned by Google Business Profile. Null until Google confirms a publish.';


--
-- Name: grm_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    location_id uuid NOT NULL,
    google_review_name text NOT NULL,
    google_review_id text NOT NULL,
    reviewer_display_name text DEFAULT ''::text NOT NULL,
    reviewer_profile_url text,
    reviewer_is_anonymous boolean DEFAULT false NOT NULL,
    star_rating smallint NOT NULL,
    comment text,
    review_create_time timestamp with time zone NOT NULL,
    review_update_time timestamp with time zone,
    google_reply_comment text,
    google_reply_update_time timestamp with time zone,
    review_url text,
    reply_status public.grm_reply_status DEFAULT 'none'::public.grm_reply_status NOT NULL,
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    review_language text,
    complaint_theme text,
    assigned_to uuid,
    reopened_at timestamp with time zone,
    content_fingerprint text,
    response_fingerprint text,
    missing_on_google_at timestamp with time zone,
    downstream_stale_at timestamp with time zone,
    CONSTRAINT grm_reviews_star_rating_check CHECK (((star_rating >= 1) AND (star_rating <= 5)))
);


--
-- Name: TABLE grm_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_reviews IS 'Local copy of a Google Business Profile review. Safe to re-sync idempotently.';


--
-- Name: COLUMN grm_reviews.google_review_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.google_review_name IS 'Full Google resource name. Primary external key for idempotent upsert.';


--
-- Name: COLUMN grm_reviews.comment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.comment IS 'Null when the reviewer left a rating without a written comment.';


--
-- Name: COLUMN grm_reviews.sync_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.sync_hash IS 'SHA-256 of the raw Google review JSON. Used to detect changes without full comparison.';


--
-- Name: COLUMN grm_reviews.review_language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.review_language IS 'Script-based language of the review text. none means there is no text. Not a Google language code.';


--
-- Name: COLUMN grm_reviews.complaint_theme; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.complaint_theme IS 'Keyword theme for a 1–3 star review. Null on 4–5 star reviews.';


--
-- Name: COLUMN grm_reviews.reopened_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.reopened_at IS 'Set when Google changes the text or stars after a reply was published.';


--
-- Name: COLUMN grm_reviews.content_fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.content_fingerprint IS 'SHA-256 of canonical star rating, comment, and create time. grm_review_intelligence.content_hash stores this value. sync_hash still includes Google update times so a timestamp-only change is stored without reprocessing.';


--
-- Name: COLUMN grm_reviews.response_fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.response_fingerprint IS 'SHA-256 of the canonical Google reply comment. An empty reply has a stable hash. A reply-only change invalidates summaries and does not reclassify the review text.';


--
-- Name: COLUMN grm_reviews.missing_on_google_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.missing_on_google_at IS 'Set only after a full location sync that finished every page without a provider error and did not see this google_review_name. Incremental sync and any failed or truncated sync must leave it null. The review row is kept.';


--
-- Name: COLUMN grm_reviews.downstream_stale_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_reviews.downstream_stale_at IS 'When the content or Google reply fingerprint last changed. A ready summary generated before this instant is stale.';


--
-- Name: grm_scope_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_scope_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    scope text NOT NULL,
    client_id uuid,
    group_id uuid,
    location_id uuid,
    tone_voice text,
    tone_note text,
    sla_hours integer,
    routing_level text,
    drafts_paused boolean,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tone jsonb,
    automation jsonb,
    CONSTRAINT grm_scope_settings_check CHECK ((((scope = 'client'::text) AND (client_id IS NOT NULL) AND (group_id IS NULL) AND (location_id IS NULL)) OR ((scope = 'group'::text) AND (group_id IS NOT NULL) AND (client_id IS NULL) AND (location_id IS NULL)) OR ((scope = 'location'::text) AND (location_id IS NOT NULL) AND (client_id IS NULL) AND (group_id IS NULL)))),
    CONSTRAINT grm_scope_settings_routing_level_check CHECK (((routing_level IS NULL) OR (routing_level = ANY (ARRAY['store'::text, 'regional'::text, 'leadership'::text])))),
    CONSTRAINT grm_scope_settings_scope_check CHECK ((scope = ANY (ARRAY['client'::text, 'group'::text, 'location'::text]))),
    CONSTRAINT grm_scope_settings_sla_hours_check CHECK (((sla_hours IS NULL) OR ((sla_hours >= 1) AND (sla_hours <= 168)))),
    CONSTRAINT grm_scope_settings_tone_note_check CHECK (((tone_note IS NULL) OR (char_length(tone_note) <= 500))),
    CONSTRAINT grm_scope_settings_tone_voice_check CHECK (((tone_voice IS NULL) OR (tone_voice = ANY (ARRAY['warm'::text, 'professional'::text, 'brief'::text]))))
);


--
-- Name: grm_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_usage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    client_id uuid,
    kind text NOT NULL,
    source_id text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grm_usage_events_kind_check CHECK ((kind = ANY (ARRAY['reply_published'::text, 'client_connected'::text, 'client_created'::text])))
);


--
-- Name: grm_user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_user_consents (
    user_id uuid NOT NULL,
    terms_accepted_at timestamp with time zone NOT NULL,
    ai_accepted_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE grm_user_consents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_user_consents IS 'Recorded the first time a person accepts the Terms and the AI disclosure. Later sign-ins skip that step.';


--
-- Name: grm_workspace_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_workspace_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role public.grm_member_role DEFAULT 'member'::public.grm_member_role NOT NULL,
    invited_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    scope_client_id uuid,
    scope_group_id uuid,
    scope_location_id uuid,
    CONSTRAINT grm_invites_one_scope CHECK ((((
CASE
    WHEN (scope_client_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (scope_group_id IS NULL) THEN 0
    ELSE 1
END) +
CASE
    WHEN (scope_location_id IS NULL) THEN 0
    ELSE 1
END) <= 1)),
    CONSTRAINT grm_workspace_invites_email_check CHECK (((email = lower(email)) AND (char_length(email) >= 3) AND (char_length(email) <= 320))),
    CONSTRAINT grm_workspace_invites_role_check CHECK ((role <> 'owner'::public.grm_member_role)),
    CONSTRAINT grm_workspace_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text])))
);


--
-- Name: TABLE grm_workspace_invites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_workspace_invites IS 'Email invite into a workspace. Accepted on the invitee''s next sign-in. No email is sent.';


--
-- Name: COLUMN grm_workspace_invites.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grm_workspace_invites.expires_at IS 'Pending invites stop being accepted after this time. No email is sent.';


--
-- Name: grm_workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.grm_member_role DEFAULT 'member'::public.grm_member_role NOT NULL,
    invited_by uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT false NOT NULL,
    access_enabled boolean DEFAULT true NOT NULL,
    scope_client_id uuid,
    scope_group_id uuid,
    scope_location_id uuid,
    alert_email boolean DEFAULT false NOT NULL,
    alert_in_app boolean DEFAULT true NOT NULL,
    CONSTRAINT grm_members_one_scope CHECK ((((
CASE
    WHEN (scope_client_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (scope_group_id IS NULL) THEN 0
    ELSE 1
END) +
CASE
    WHEN (scope_location_id IS NULL) THEN 0
    ELSE 1
END) <= 1))
);


--
-- Name: TABLE grm_workspace_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_workspace_members IS 'Maps authn.users into workspaces with a role. Source of truth for tenant access.';


--
-- Name: grm_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grm_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    suspended_at timestamp with time zone,
    deleted_at timestamp with time zone,
    plan text DEFAULT 'trial'::text NOT NULL,
    plan_expires_at timestamp with time zone,
    ai_monthly_budget_usd numeric(10,2),
    max_locations integer,
    max_members integer,
    admin_note text,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT grm_workspaces_admin_note_check CHECK (((admin_note IS NULL) OR (char_length(admin_note) <= 2000))),
    CONSTRAINT grm_workspaces_ai_monthly_budget_usd_check CHECK (((ai_monthly_budget_usd IS NULL) OR (ai_monthly_budget_usd >= (0)::numeric))),
    CONSTRAINT grm_workspaces_max_locations_check CHECK (((max_locations IS NULL) OR (max_locations > 0))),
    CONSTRAINT grm_workspaces_max_members_check CHECK (((max_members IS NULL) OR (max_members > 0))),
    CONSTRAINT grm_workspaces_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 255))),
    CONSTRAINT grm_workspaces_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'starter'::text, 'growth'::text, 'enterprise'::text, 'lifetime'::text]))),
    CONSTRAINT grm_workspaces_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]$'::text)),
    CONSTRAINT grm_workspaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])))
);


--
-- Name: TABLE grm_workspaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grm_workspaces IS 'Top-level tenant unit. Each workspace is an isolated GRM customer.';


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_provider_providerAccountId_key; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.accounts
    ADD CONSTRAINT "accounts_provider_providerAccountId_key" UNIQUE (provider, "providerAccountId");


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_sessionToken_key; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.sessions
    ADD CONSTRAINT "sessions_sessionToken_key" UNIQUE ("sessionToken");


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification_token verification_token_pkey; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.verification_token
    ADD CONSTRAINT verification_token_pkey PRIMARY KEY (identifier, token);


--
-- Name: verification_token verification_token_token_key; Type: CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.verification_token
    ADD CONSTRAINT verification_token_token_key UNIQUE (token);


--
-- Name: grm_access_requests grm_access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_access_requests
    ADD CONSTRAINT grm_access_requests_pkey PRIMARY KEY (id);


--
-- Name: grm_agency_branding grm_agency_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_agency_branding
    ADD CONSTRAINT grm_agency_branding_pkey PRIMARY KEY (workspace_id);


--
-- Name: grm_ai_call_events grm_ai_call_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_call_events
    ADD CONSTRAINT grm_ai_call_events_pkey PRIMARY KEY (id);


--
-- Name: grm_ai_configs grm_ai_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_configs
    ADD CONSTRAINT grm_ai_configs_pkey PRIMARY KEY (id);


--
-- Name: grm_ai_configs grm_ai_configs_workspace_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_configs
    ADD CONSTRAINT grm_ai_configs_workspace_id_version_key UNIQUE (workspace_id, version);


--
-- Name: grm_ai_generation_jobs grm_ai_generation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_generation_jobs
    ADD CONSTRAINT grm_ai_generation_jobs_pkey PRIMARY KEY (id);


--
-- Name: grm_ai_knowledge grm_ai_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_knowledge
    ADD CONSTRAINT grm_ai_knowledge_pkey PRIMARY KEY (id);


--
-- Name: grm_ai_usage_monthly grm_ai_usage_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_usage_monthly
    ADD CONSTRAINT grm_ai_usage_monthly_pkey PRIMARY KEY (workspace_id, month, operation);


--
-- Name: grm_alert_deliveries grm_alert_deliveries_event_id_channel_recipient_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_deliveries
    ADD CONSTRAINT grm_alert_deliveries_event_id_channel_recipient_key UNIQUE (event_id, channel, recipient);


--
-- Name: grm_alert_deliveries grm_alert_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_deliveries
    ADD CONSTRAINT grm_alert_deliveries_pkey PRIMARY KEY (id);


--
-- Name: grm_alert_events grm_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_events
    ADD CONSTRAINT grm_alert_events_pkey PRIMARY KEY (id);


--
-- Name: grm_alert_events grm_alert_events_workspace_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_events
    ADD CONSTRAINT grm_alert_events_workspace_id_fingerprint_key UNIQUE (workspace_id, fingerprint);


--
-- Name: grm_alert_rules grm_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_pkey PRIMARY KEY (id);


--
-- Name: grm_analysis_runs grm_analysis_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_analysis_runs
    ADD CONSTRAINT grm_analysis_runs_pkey PRIMARY KEY (id);


--
-- Name: grm_audit_logs grm_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_audit_logs
    ADD CONSTRAINT grm_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: grm_autoreply_pauses grm_autoreply_pauses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_autoreply_pauses
    ADD CONSTRAINT grm_autoreply_pauses_pkey PRIMARY KEY (id);


--
-- Name: grm_brands grm_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_brands
    ADD CONSTRAINT grm_brands_pkey PRIMARY KEY (id);


--
-- Name: grm_bulk_jobs grm_bulk_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_bulk_jobs
    ADD CONSTRAINT grm_bulk_jobs_pkey PRIMARY KEY (id);


--
-- Name: grm_client_onboarding grm_client_onboarding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_client_onboarding
    ADD CONSTRAINT grm_client_onboarding_pkey PRIMARY KEY (id);


--
-- Name: grm_client_onboarding grm_client_onboarding_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_client_onboarding
    ADD CONSTRAINT grm_client_onboarding_token_hash_key UNIQUE (token_hash);


--
-- Name: grm_clients grm_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_clients
    ADD CONSTRAINT grm_clients_pkey PRIMARY KEY (id);


--
-- Name: grm_escalation_events grm_escalation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_events
    ADD CONSTRAINT grm_escalation_events_pkey PRIMARY KEY (id);


--
-- Name: grm_escalation_policies grm_escalation_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_policies
    ADD CONSTRAINT grm_escalation_policies_pkey PRIMARY KEY (workspace_id);


--
-- Name: grm_escalation_reminders grm_escalation_reminders_escalation_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_reminders
    ADD CONSTRAINT grm_escalation_reminders_escalation_id_kind_key UNIQUE (escalation_id, kind);


--
-- Name: grm_escalation_reminders grm_escalation_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_reminders
    ADD CONSTRAINT grm_escalation_reminders_pkey PRIMARY KEY (id);


--
-- Name: grm_escalations grm_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_pkey PRIMARY KEY (id);


--
-- Name: grm_google_accounts grm_google_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_accounts
    ADD CONSTRAINT grm_google_accounts_pkey PRIMARY KEY (id);


--
-- Name: grm_google_accounts grm_google_accounts_workspace_id_google_account_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_accounts
    ADD CONSTRAINT grm_google_accounts_workspace_id_google_account_name_key UNIQUE (workspace_id, google_account_name);


--
-- Name: grm_google_connections grm_google_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_connections
    ADD CONSTRAINT grm_google_connections_pkey PRIMARY KEY (id);


--
-- Name: grm_google_connections grm_google_connections_workspace_id_google_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_connections
    ADD CONSTRAINT grm_google_connections_workspace_id_google_email_key UNIQUE (workspace_id, google_email);


--
-- Name: grm_google_locations grm_google_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_pkey PRIMARY KEY (id);


--
-- Name: grm_google_locations grm_google_locations_workspace_id_google_location_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_workspace_id_google_location_name_key UNIQUE (workspace_id, google_location_name);


--
-- Name: grm_groups grm_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_groups
    ADD CONSTRAINT grm_groups_pkey PRIMARY KEY (id);


--
-- Name: grm_insight_reports grm_insight_reports_cache_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_cache_unique UNIQUE (workspace_id, cache_key);


--
-- Name: grm_insight_reports grm_insight_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_pkey PRIMARY KEY (id);


--
-- Name: grm_location_groups grm_location_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_groups
    ADD CONSTRAINT grm_location_groups_pkey PRIMARY KEY (id);


--
-- Name: grm_location_managers grm_location_managers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_managers
    ADD CONSTRAINT grm_location_managers_pkey PRIMARY KEY (location_id);


--
-- Name: grm_location_tag_links grm_location_tag_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tag_links
    ADD CONSTRAINT grm_location_tag_links_pkey PRIMARY KEY (location_id, tag_id);


--
-- Name: grm_location_tags grm_location_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tags
    ADD CONSTRAINT grm_location_tags_pkey PRIMARY KEY (id);


--
-- Name: grm_location_tags grm_location_tags_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tags
    ADD CONSTRAINT grm_location_tags_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: grm_notifications grm_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_notifications
    ADD CONSTRAINT grm_notifications_pkey PRIMARY KEY (id);


--
-- Name: grm_onboarding grm_onboarding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_onboarding
    ADD CONSTRAINT grm_onboarding_pkey PRIMARY KEY (workspace_id);


--
-- Name: grm_platform_announcements grm_platform_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_announcements
    ADD CONSTRAINT grm_platform_announcements_pkey PRIMARY KEY (id);


--
-- Name: grm_platform_blocked_users grm_platform_blocked_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_blocked_users
    ADD CONSTRAINT grm_platform_blocked_users_pkey PRIMARY KEY (email);


--
-- Name: grm_platform_invites grm_platform_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_invites
    ADD CONSTRAINT grm_platform_invites_pkey PRIMARY KEY (id);


--
-- Name: grm_platform_settings grm_platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_settings
    ADD CONSTRAINT grm_platform_settings_pkey PRIMARY KEY (key);


--
-- Name: grm_reply_settings grm_reply_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_settings
    ADD CONSTRAINT grm_reply_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: grm_reply_templates grm_reply_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_templates
    ADD CONSTRAINT grm_reply_templates_pkey PRIMARY KEY (id);


--
-- Name: grm_report_deliveries grm_report_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_deliveries
    ADD CONSTRAINT grm_report_deliveries_pkey PRIMARY KEY (id);


--
-- Name: grm_report_deliveries grm_report_deliveries_run_id_channel_recipient_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_deliveries
    ADD CONSTRAINT grm_report_deliveries_run_id_channel_recipient_key UNIQUE (run_id, channel, recipient);


--
-- Name: grm_report_runs grm_report_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_runs
    ADD CONSTRAINT grm_report_runs_pkey PRIMARY KEY (id);


--
-- Name: grm_report_schedules grm_report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_pkey PRIMARY KEY (id);


--
-- Name: grm_reports grm_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_pkey PRIMARY KEY (id);


--
-- Name: grm_request_campaign_locations grm_request_campaign_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_campaign_locations
    ADD CONSTRAINT grm_request_campaign_locations_pkey PRIMARY KEY (campaign_id, location_id);


--
-- Name: grm_request_campaigns grm_request_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_campaigns
    ADD CONSTRAINT grm_request_campaigns_pkey PRIMARY KEY (id);


--
-- Name: grm_request_customers grm_request_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_customers
    ADD CONSTRAINT grm_request_customers_pkey PRIMARY KEY (id);


--
-- Name: grm_request_customers grm_request_customers_workspace_id_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_customers
    ADD CONSTRAINT grm_request_customers_workspace_id_dedupe_key_key UNIQUE (workspace_id, dedupe_key);


--
-- Name: grm_request_events grm_request_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_events
    ADD CONSTRAINT grm_request_events_pkey PRIMARY KEY (id);


--
-- Name: grm_request_feedback grm_request_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_feedback
    ADD CONSTRAINT grm_request_feedback_pkey PRIMARY KEY (id);


--
-- Name: grm_request_messages grm_request_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_pkey PRIMARY KEY (id);


--
-- Name: grm_request_messages grm_request_messages_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_token_key UNIQUE (token);


--
-- Name: grm_request_policies grm_request_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_policies
    ADD CONSTRAINT grm_request_policies_pkey PRIMARY KEY (workspace_id);


--
-- Name: grm_request_qr grm_request_qr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_qr
    ADD CONSTRAINT grm_request_qr_pkey PRIMARY KEY (id);


--
-- Name: grm_request_qr grm_request_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_qr
    ADD CONSTRAINT grm_request_qr_token_key UNIQUE (token);


--
-- Name: grm_request_qr grm_request_qr_workspace_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_qr
    ADD CONSTRAINT grm_request_qr_workspace_id_location_id_key UNIQUE (workspace_id, location_id);


--
-- Name: grm_request_recipients grm_request_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_recipients
    ADD CONSTRAINT grm_request_recipients_pkey PRIMARY KEY (campaign_id, customer_id);


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_pkey PRIMARY KEY (id);


--
-- Name: grm_review_analyses grm_review_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_analyses
    ADD CONSTRAINT grm_review_analyses_pkey PRIMARY KEY (id);


--
-- Name: grm_review_analyses grm_review_analyses_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_analyses
    ADD CONSTRAINT grm_review_analyses_version_unique UNIQUE (review_id, analysis_version);


--
-- Name: grm_review_notes grm_review_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_notes
    ADD CONSTRAINT grm_review_notes_pkey PRIMARY KEY (id);


--
-- Name: grm_review_observations grm_review_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_pkey PRIMARY KEY (id);


--
-- Name: grm_review_replies grm_review_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_pkey PRIMARY KEY (id);


--
-- Name: grm_reviews grm_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reviews
    ADD CONSTRAINT grm_reviews_pkey PRIMARY KEY (id);


--
-- Name: grm_reviews grm_reviews_workspace_id_google_review_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reviews
    ADD CONSTRAINT grm_reviews_workspace_id_google_review_name_key UNIQUE (workspace_id, google_review_name);


--
-- Name: grm_scope_settings grm_scope_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_scope_settings
    ADD CONSTRAINT grm_scope_settings_pkey PRIMARY KEY (id);


--
-- Name: grm_usage_events grm_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_usage_events
    ADD CONSTRAINT grm_usage_events_pkey PRIMARY KEY (id);


--
-- Name: grm_usage_events grm_usage_events_workspace_id_kind_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_usage_events
    ADD CONSTRAINT grm_usage_events_workspace_id_kind_source_id_key UNIQUE (workspace_id, kind, source_id);


--
-- Name: grm_user_consents grm_user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_user_consents
    ADD CONSTRAINT grm_user_consents_pkey PRIMARY KEY (user_id);


--
-- Name: grm_workspace_invites grm_workspace_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_pkey PRIMARY KEY (id);


--
-- Name: grm_workspace_invites grm_workspace_invites_workspace_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_workspace_id_email_key UNIQUE (workspace_id, email);


--
-- Name: grm_workspace_members grm_workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_pkey PRIMARY KEY (id);


--
-- Name: grm_workspace_members grm_workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: grm_workspaces grm_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspaces
    ADD CONSTRAINT grm_workspaces_pkey PRIMARY KEY (id);


--
-- Name: grm_workspaces grm_workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspaces
    ADD CONSTRAINT grm_workspaces_slug_key UNIQUE (slug);


--
-- Name: accounts_user; Type: INDEX; Schema: authn; Owner: -
--

CREATE INDEX accounts_user ON authn.accounts USING btree ("userId");


--
-- Name: sessions_expiry; Type: INDEX; Schema: authn; Owner: -
--

CREATE INDEX sessions_expiry ON authn.sessions USING btree (expires);


--
-- Name: sessions_user; Type: INDEX; Schema: authn; Owner: -
--

CREATE INDEX sessions_user ON authn.sessions USING btree ("userId");


--
-- Name: users_email_normalized; Type: INDEX; Schema: authn; Owner: -
--

CREATE UNIQUE INDEX users_email_normalized ON authn.users USING btree (lower(email));


--
-- Name: grm_access_requests_one_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_access_requests_one_pending_email ON public.grm_access_requests USING btree (email) WHERE (status = 'pending'::text);


--
-- Name: grm_access_requests_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_access_requests_pending ON public.grm_access_requests USING btree (created_at DESC) WHERE (status = 'pending'::text);


--
-- Name: grm_ai_call_events_workspace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_ai_call_events_workspace_time ON public.grm_ai_call_events USING btree (workspace_id, created_at DESC);


--
-- Name: grm_ai_configs_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_ai_configs_one_active ON public.grm_ai_configs USING btree (workspace_id) WHERE (status = 'active'::text);


--
-- Name: grm_analysis_runs_workspace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_analysis_runs_workspace_time ON public.grm_analysis_runs USING btree (workspace_id, created_at DESC);


--
-- Name: grm_autoreply_pause_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_autoreply_pause_client ON public.grm_autoreply_pauses USING btree (client_id) WHERE ((scope = 'client'::text) AND (cleared_at IS NULL));


--
-- Name: grm_autoreply_pause_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_autoreply_pause_location ON public.grm_autoreply_pauses USING btree (location_id) WHERE ((scope = 'location'::text) AND (cleared_at IS NULL));


--
-- Name: grm_autoreply_pause_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_autoreply_pause_workspace ON public.grm_autoreply_pauses USING btree (workspace_id) WHERE ((scope = 'workspace'::text) AND (cleared_at IS NULL));


--
-- Name: grm_brands_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_brands_client ON public.grm_brands USING btree (workspace_id, client_id);


--
-- Name: grm_clients_auto_loc_marker_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_clients_auto_loc_marker_uidx ON public.grm_clients USING btree (workspace_id, notes) WHERE (notes ~~ 'grm:auto:loc:%'::text);


--
-- Name: grm_clients_unassigned_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_clients_unassigned_active_uidx ON public.grm_clients USING btree (workspace_id) WHERE ((notes = 'grm:system:unassigned'::text) AND (is_active = true));


--
-- Name: grm_escalation_events_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_escalation_events_case ON public.grm_escalation_events USING btree (escalation_id, created_at);


--
-- Name: grm_escalations_one_open_review; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_escalations_one_open_review ON public.grm_escalations USING btree (workspace_id, review_id) WHERE (status <> 'resolved'::text);


--
-- Name: grm_escalations_ticket_no; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_escalations_ticket_no ON public.grm_escalations USING btree (workspace_id, ticket_no);


--
-- Name: grm_escalations_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_escalations_workspace_status ON public.grm_escalations USING btree (workspace_id, status, opened_at DESC);


--
-- Name: grm_groups_name_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_groups_name_scope ON public.grm_groups USING btree (workspace_id, client_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));


--
-- Name: grm_idx_accounts_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_accounts_connection ON public.grm_google_accounts USING btree (connection_id);


--
-- Name: grm_idx_accounts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_accounts_workspace ON public.grm_google_accounts USING btree (workspace_id);


--
-- Name: grm_idx_ai_configs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_configs_workspace ON public.grm_ai_configs USING btree (workspace_id, status);


--
-- Name: grm_idx_ai_drafts_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_drafts_review ON public.grm_review_ai_drafts USING btree (review_id);


--
-- Name: grm_idx_ai_drafts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_drafts_workspace ON public.grm_review_ai_drafts USING btree (workspace_id);


--
-- Name: grm_idx_ai_jobs_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_jobs_review ON public.grm_ai_generation_jobs USING btree (review_id);


--
-- Name: grm_idx_ai_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_jobs_status ON public.grm_ai_generation_jobs USING btree (status, updated_at);


--
-- Name: grm_idx_ai_knowledge_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ai_knowledge_workspace ON public.grm_ai_knowledge USING btree (workspace_id, kind, enabled);


--
-- Name: grm_idx_alert_events_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_alert_events_recent ON public.grm_alert_events USING btree (workspace_id, triggered_at DESC);


--
-- Name: grm_idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_audit_entity ON public.grm_audit_logs USING btree (entity_type, entity_id);


--
-- Name: grm_idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_audit_user ON public.grm_audit_logs USING btree (user_id, created_at DESC);


--
-- Name: grm_idx_audit_workspace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_audit_workspace_time ON public.grm_audit_logs USING btree (workspace_id, created_at DESC);


--
-- Name: grm_idx_bulk_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_bulk_jobs_status ON public.grm_bulk_jobs USING btree (status, updated_at);


--
-- Name: grm_idx_clients_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_clients_workspace ON public.grm_clients USING btree (workspace_id) WHERE (is_active = true);


--
-- Name: grm_idx_connections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_connections_status ON public.grm_google_connections USING btree (workspace_id, status);


--
-- Name: grm_idx_connections_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_connections_workspace ON public.grm_google_connections USING btree (workspace_id);


--
-- Name: grm_idx_escalation_reminders_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_escalation_reminders_due ON public.grm_escalation_reminders USING btree (due_at) WHERE (sent_at IS NULL);


--
-- Name: grm_idx_escalations_workspace_location_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_escalations_workspace_location_status ON public.grm_escalations USING btree (workspace_id, location_id, status);


--
-- Name: grm_idx_escalations_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_escalations_workspace_status ON public.grm_escalations USING btree (workspace_id, status);


--
-- Name: grm_idx_google_locations_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_google_locations_group ON public.grm_google_locations USING btree (group_id);


--
-- Name: grm_idx_groups_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_groups_client ON public.grm_groups USING btree (client_id);


--
-- Name: grm_idx_groups_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_groups_parent ON public.grm_groups USING btree (parent_id);


--
-- Name: grm_idx_location_groups_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_location_groups_client ON public.grm_location_groups USING btree (client_id);


--
-- Name: grm_idx_location_groups_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_location_groups_parent ON public.grm_location_groups USING btree (parent_id);


--
-- Name: grm_idx_location_groups_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_location_groups_workspace ON public.grm_location_groups USING btree (workspace_id);


--
-- Name: grm_idx_locations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_locations_active ON public.grm_google_locations USING btree (workspace_id) WHERE (is_active = true);


--
-- Name: grm_idx_locations_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_locations_client ON public.grm_google_locations USING btree (client_id);


--
-- Name: grm_idx_locations_sync_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_locations_sync_state ON public.grm_google_locations USING btree (workspace_id, last_synced_at NULLS FIRST);


--
-- Name: grm_idx_locations_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_locations_workspace ON public.grm_google_locations USING btree (workspace_id);


--
-- Name: grm_idx_replies_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_replies_review ON public.grm_review_replies USING btree (review_id);


--
-- Name: grm_idx_replies_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_replies_workspace_status ON public.grm_review_replies USING btree (workspace_id, status);


--
-- Name: grm_idx_report_schedules_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_report_schedules_due ON public.grm_report_schedules USING btree (next_run_at) WHERE enabled;


--
-- Name: grm_idx_request_events_qr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_request_events_qr ON public.grm_request_events USING btree (qr_id, kind);


--
-- Name: grm_idx_request_messages_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_request_messages_retry ON public.grm_request_messages USING btree (next_attempt_at) WHERE ((status = ANY (ARRAY['queued'::text, 'failed'::text])) AND (retryable = true));


--
-- Name: grm_idx_review_notes_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_review_notes_review ON public.grm_review_notes USING btree (review_id, created_at DESC);


--
-- Name: grm_idx_reviews_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_assignee ON public.grm_reviews USING btree (workspace_id, assigned_to);


--
-- Name: grm_idx_reviews_content_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_content_fingerprint ON public.grm_reviews USING btree (workspace_id, location_id, content_fingerprint);


--
-- Name: grm_idx_reviews_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_create_time ON public.grm_reviews USING btree (workspace_id, review_create_time DESC);


--
-- Name: grm_idx_reviews_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_language ON public.grm_reviews USING btree (workspace_id, review_language);


--
-- Name: grm_idx_reviews_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_location ON public.grm_reviews USING btree (location_id);


--
-- Name: grm_idx_reviews_missing_on_google; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_missing_on_google ON public.grm_reviews USING btree (workspace_id, location_id) WHERE (missing_on_google_at IS NOT NULL);


--
-- Name: grm_idx_reviews_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_rating ON public.grm_reviews USING btree (workspace_id, star_rating, review_create_time DESC);


--
-- Name: grm_idx_reviews_reply_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_reply_status ON public.grm_reviews USING btree (workspace_id, reply_status);


--
-- Name: grm_idx_reviews_theme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_theme ON public.grm_reviews USING btree (workspace_id, complaint_theme);


--
-- Name: grm_idx_reviews_unanswered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_unanswered ON public.grm_reviews USING btree (workspace_id, review_create_time DESC) WHERE (reply_status = 'none'::public.grm_reply_status);


--
-- Name: grm_idx_reviews_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_workspace ON public.grm_reviews USING btree (workspace_id);


--
-- Name: grm_idx_reviews_workspace_location_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_reviews_workspace_location_time ON public.grm_reviews USING btree (workspace_id, location_id, review_create_time DESC);


--
-- Name: grm_idx_ws_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ws_members_user_id ON public.grm_workspace_members USING btree (user_id);


--
-- Name: grm_idx_ws_members_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_idx_ws_members_workspace_id ON public.grm_workspace_members USING btree (workspace_id);


--
-- Name: grm_insight_reports_workspace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_insight_reports_workspace_time ON public.grm_insight_reports USING btree (workspace_id, created_at DESC);


--
-- Name: grm_location_groups_name_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_location_groups_name_scope ON public.grm_location_groups USING btree (workspace_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));


--
-- Name: grm_notifications_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_notifications_dedupe ON public.grm_notifications USING btree (workspace_id, user_id, dedupe_key);


--
-- Name: grm_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_notifications_unread ON public.grm_notifications USING btree (workspace_id, user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: grm_platform_invites_one_accepted_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_platform_invites_one_accepted_email ON public.grm_platform_invites USING btree (email) WHERE (status = 'accepted'::text);


--
-- Name: grm_platform_invites_one_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_platform_invites_one_pending_email ON public.grm_platform_invites USING btree (email) WHERE (status = 'pending'::text);


--
-- Name: grm_platform_invites_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_platform_invites_pending_email ON public.grm_platform_invites USING btree (email) WHERE (status = 'pending'::text);


--
-- Name: grm_report_runs_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_report_runs_slot ON public.grm_report_runs USING btree (schedule_id, slot) WHERE (slot IS NOT NULL);


--
-- Name: grm_request_feedback_one_message; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_request_feedback_one_message ON public.grm_request_feedback USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: grm_request_messages_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_request_messages_once ON public.grm_request_messages USING btree (campaign_id, customer_id) WHERE ((is_reminder = false) AND (is_test = false) AND (customer_id IS NOT NULL));


--
-- Name: grm_request_messages_one_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_request_messages_one_reminder ON public.grm_request_messages USING btree (reminder_of) WHERE (reminder_of IS NOT NULL);


--
-- Name: grm_review_analyses_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_review_analyses_one_current ON public.grm_review_analyses USING btree (review_id) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'no_text'::text]));


--
-- Name: grm_review_analyses_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_review_analyses_workspace_status ON public.grm_review_analyses USING btree (workspace_id, status, updated_at);


--
-- Name: grm_review_observations_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_review_observations_dedupe ON public.grm_review_observations USING btree (analysis_id, dedupe_key);


--
-- Name: grm_review_observations_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_review_observations_review ON public.grm_review_observations USING btree (review_id);


--
-- Name: grm_review_observations_scope_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_review_observations_scope_time ON public.grm_review_observations USING btree (workspace_id, location_id, review_create_time DESC);


--
-- Name: grm_review_observations_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_review_observations_staff ON public.grm_review_observations USING btree (workspace_id, entity_name) WHERE (entity_type = 'staff'::text);


--
-- Name: grm_review_observations_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_review_observations_topic ON public.grm_review_observations USING btree (workspace_id, sentiment, topic);


--
-- Name: grm_review_replies_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_review_replies_one_active ON public.grm_review_replies USING btree (review_id) WHERE (status = ANY (ARRAY['draft'::public.grm_reply_pub_status, 'approved'::public.grm_reply_pub_status, 'pending_publish'::public.grm_reply_pub_status, 'published'::public.grm_reply_pub_status]));


--
-- Name: grm_scope_settings_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_scope_settings_client ON public.grm_scope_settings USING btree (workspace_id, client_id) WHERE (scope = 'client'::text);


--
-- Name: grm_scope_settings_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_scope_settings_group ON public.grm_scope_settings USING btree (workspace_id, group_id) WHERE (scope = 'group'::text);


--
-- Name: grm_scope_settings_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_scope_settings_location ON public.grm_scope_settings USING btree (workspace_id, location_id) WHERE (scope = 'location'::text);


--
-- Name: grm_uq_ai_drafts_generation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_uq_ai_drafts_generation ON public.grm_review_ai_drafts USING btree (generation_id) WHERE (generation_id IS NOT NULL);


--
-- Name: grm_workspace_invites_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_workspace_invites_pending_email ON public.grm_workspace_invites USING btree (email) WHERE (status = 'pending'::text);


--
-- Name: grm_workspace_members_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grm_workspace_members_one_active ON public.grm_workspace_members USING btree (user_id) WHERE active;


--
-- Name: grm_workspaces_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grm_workspaces_status ON public.grm_workspaces USING btree (status);


--
-- Name: grm_escalations grm_assign_escalation_ticket; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER grm_assign_escalation_ticket BEFORE INSERT ON public.grm_escalations FOR EACH ROW EXECUTE FUNCTION public.grm_assign_escalation_ticket();


--
-- Name: grm_ai_configs trg_grm_ai_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_ai_configs_updated_at BEFORE UPDATE ON public.grm_ai_configs FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_ai_generation_jobs trg_grm_ai_generation_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_ai_generation_jobs_updated_at BEFORE UPDATE ON public.grm_ai_generation_jobs FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_ai_knowledge trg_grm_ai_knowledge_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_ai_knowledge_updated_at BEFORE UPDATE ON public.grm_ai_knowledge FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_alert_rules trg_grm_alert_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_alert_rules_updated_at BEFORE UPDATE ON public.grm_alert_rules FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_analysis_runs trg_grm_analysis_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_analysis_runs_updated_at BEFORE UPDATE ON public.grm_analysis_runs FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_bulk_jobs trg_grm_bulk_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_bulk_jobs_updated_at BEFORE UPDATE ON public.grm_bulk_jobs FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_clients trg_grm_clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_clients_updated_at BEFORE UPDATE ON public.grm_clients FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_google_accounts trg_grm_google_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_google_accounts_updated_at BEFORE UPDATE ON public.grm_google_accounts FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_google_connections trg_grm_google_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_google_connections_updated_at BEFORE UPDATE ON public.grm_google_connections FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_google_locations trg_grm_google_locations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_google_locations_updated_at BEFORE UPDATE ON public.grm_google_locations FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_google_locations trg_grm_guard_location_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_guard_location_assignment BEFORE INSERT OR UPDATE OF group_id, client_id, workspace_id ON public.grm_google_locations FOR EACH ROW EXECUTE FUNCTION public.grm_guard_location_assignment();


--
-- Name: grm_location_groups trg_grm_guard_location_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_guard_location_group BEFORE INSERT OR UPDATE ON public.grm_location_groups FOR EACH ROW EXECUTE FUNCTION public.grm_guard_location_group();


--
-- Name: grm_insight_reports trg_grm_insight_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_insight_reports_updated_at BEFORE UPDATE ON public.grm_insight_reports FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_location_groups trg_grm_location_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_location_groups_updated_at BEFORE UPDATE ON public.grm_location_groups FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_onboarding trg_grm_onboarding_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_onboarding_updated_at BEFORE UPDATE ON public.grm_onboarding FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_platform_invites trg_grm_platform_invites_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_platform_invites_updated_at BEFORE UPDATE ON public.grm_platform_invites FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_report_schedules trg_grm_report_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_report_schedules_updated_at BEFORE UPDATE ON public.grm_report_schedules FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_request_campaigns trg_grm_request_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_request_campaigns_updated_at BEFORE UPDATE ON public.grm_request_campaigns FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_request_policies trg_grm_request_policies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_request_policies_updated_at BEFORE UPDATE ON public.grm_request_policies FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_review_ai_drafts trg_grm_review_ai_drafts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_review_ai_drafts_updated_at BEFORE UPDATE ON public.grm_review_ai_drafts FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_review_analyses trg_grm_review_analyses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_review_analyses_updated_at BEFORE UPDATE ON public.grm_review_analyses FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_review_replies trg_grm_review_replies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_review_replies_updated_at BEFORE UPDATE ON public.grm_review_replies FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_reviews trg_grm_reviews_stale_analysis; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_reviews_stale_analysis AFTER UPDATE OF content_fingerprint, comment, star_rating ON public.grm_reviews FOR EACH ROW EXECUTE FUNCTION public.grm_mark_review_analysis_stale();


--
-- Name: grm_reviews trg_grm_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_reviews_updated_at BEFORE UPDATE ON public.grm_reviews FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_scope_settings trg_grm_scope_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_scope_settings_updated_at BEFORE UPDATE ON public.grm_scope_settings FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: grm_workspaces trg_grm_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_grm_workspaces_updated_at BEFORE UPDATE ON public.grm_workspaces FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();


--
-- Name: accounts accounts_userId_fkey; Type: FK CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.accounts
    ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_userId_fkey; Type: FK CONSTRAINT; Schema: authn; Owner: -
--

ALTER TABLE ONLY authn.sessions
    ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: grm_access_requests grm_access_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_access_requests
    ADD CONSTRAINT grm_access_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_access_requests grm_access_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_access_requests
    ADD CONSTRAINT grm_access_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_agency_branding grm_agency_branding_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_agency_branding
    ADD CONSTRAINT grm_agency_branding_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_ai_call_events grm_ai_call_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_call_events
    ADD CONSTRAINT grm_ai_call_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_ai_configs grm_ai_configs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_configs
    ADD CONSTRAINT grm_ai_configs_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_ai_configs grm_ai_configs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_configs
    ADD CONSTRAINT grm_ai_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_ai_generation_jobs grm_ai_generation_jobs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_generation_jobs
    ADD CONSTRAINT grm_ai_generation_jobs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_ai_generation_jobs grm_ai_generation_jobs_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_generation_jobs
    ADD CONSTRAINT grm_ai_generation_jobs_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_ai_generation_jobs grm_ai_generation_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_generation_jobs
    ADD CONSTRAINT grm_ai_generation_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_ai_generation_jobs grm_ai_generation_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_generation_jobs
    ADD CONSTRAINT grm_ai_generation_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_ai_knowledge grm_ai_knowledge_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_knowledge
    ADD CONSTRAINT grm_ai_knowledge_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_ai_knowledge grm_ai_knowledge_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_knowledge
    ADD CONSTRAINT grm_ai_knowledge_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_ai_knowledge grm_ai_knowledge_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_knowledge
    ADD CONSTRAINT grm_ai_knowledge_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_ai_knowledge grm_ai_knowledge_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_knowledge
    ADD CONSTRAINT grm_ai_knowledge_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_ai_usage_monthly grm_ai_usage_monthly_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_ai_usage_monthly
    ADD CONSTRAINT grm_ai_usage_monthly_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_alert_deliveries grm_alert_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_deliveries
    ADD CONSTRAINT grm_alert_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.grm_alert_events(id) ON DELETE CASCADE;


--
-- Name: grm_alert_deliveries grm_alert_deliveries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_deliveries
    ADD CONSTRAINT grm_alert_deliveries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_alert_events grm_alert_events_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_events
    ADD CONSTRAINT grm_alert_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_alert_events grm_alert_events_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_events
    ADD CONSTRAINT grm_alert_events_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.grm_alert_rules(id) ON DELETE CASCADE;


--
-- Name: grm_alert_events grm_alert_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_events
    ADD CONSTRAINT grm_alert_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_alert_rules grm_alert_rules_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_alert_rules grm_alert_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_alert_rules grm_alert_rules_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_location_groups(id) ON DELETE SET NULL;


--
-- Name: grm_alert_rules grm_alert_rules_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_alert_rules grm_alert_rules_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_alert_rules
    ADD CONSTRAINT grm_alert_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_analysis_runs grm_analysis_runs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_analysis_runs
    ADD CONSTRAINT grm_analysis_runs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_analysis_runs grm_analysis_runs_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_analysis_runs
    ADD CONSTRAINT grm_analysis_runs_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;


--
-- Name: grm_analysis_runs grm_analysis_runs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_analysis_runs
    ADD CONSTRAINT grm_analysis_runs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_analysis_runs grm_analysis_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_analysis_runs
    ADD CONSTRAINT grm_analysis_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_audit_logs grm_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_audit_logs
    ADD CONSTRAINT grm_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_audit_logs grm_audit_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_audit_logs
    ADD CONSTRAINT grm_audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_autoreply_pauses grm_autoreply_pauses_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_autoreply_pauses
    ADD CONSTRAINT grm_autoreply_pauses_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_autoreply_pauses grm_autoreply_pauses_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_autoreply_pauses
    ADD CONSTRAINT grm_autoreply_pauses_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_autoreply_pauses grm_autoreply_pauses_paused_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_autoreply_pauses
    ADD CONSTRAINT grm_autoreply_pauses_paused_by_fkey FOREIGN KEY (paused_by) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_autoreply_pauses grm_autoreply_pauses_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_autoreply_pauses
    ADD CONSTRAINT grm_autoreply_pauses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_brands grm_brands_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_brands
    ADD CONSTRAINT grm_brands_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_brands grm_brands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_brands
    ADD CONSTRAINT grm_brands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_bulk_jobs grm_bulk_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_bulk_jobs
    ADD CONSTRAINT grm_bulk_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_bulk_jobs grm_bulk_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_bulk_jobs
    ADD CONSTRAINT grm_bulk_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_client_onboarding grm_client_onboarding_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_client_onboarding
    ADD CONSTRAINT grm_client_onboarding_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_client_onboarding grm_client_onboarding_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_client_onboarding
    ADD CONSTRAINT grm_client_onboarding_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_client_onboarding grm_client_onboarding_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_client_onboarding
    ADD CONSTRAINT grm_client_onboarding_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_clients grm_clients_account_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_clients
    ADD CONSTRAINT grm_clients_account_manager_user_id_fkey FOREIGN KEY (account_manager_user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_clients grm_clients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_clients
    ADD CONSTRAINT grm_clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_clients grm_clients_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_clients
    ADD CONSTRAINT grm_clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_escalation_events grm_escalation_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_events
    ADD CONSTRAINT grm_escalation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_escalation_events grm_escalation_events_escalation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_events
    ADD CONSTRAINT grm_escalation_events_escalation_id_fkey FOREIGN KEY (escalation_id) REFERENCES public.grm_escalations(id) ON DELETE CASCADE;


--
-- Name: grm_escalation_events grm_escalation_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_events
    ADD CONSTRAINT grm_escalation_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_escalation_policies grm_escalation_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_policies
    ADD CONSTRAINT grm_escalation_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_escalation_reminders grm_escalation_reminders_escalation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_reminders
    ADD CONSTRAINT grm_escalation_reminders_escalation_id_fkey FOREIGN KEY (escalation_id) REFERENCES public.grm_escalations(id) ON DELETE CASCADE;


--
-- Name: grm_escalation_reminders grm_escalation_reminders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalation_reminders
    ADD CONSTRAINT grm_escalation_reminders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_escalations grm_escalations_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_escalations grm_escalations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_escalations grm_escalations_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_escalations grm_escalations_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_escalations grm_escalations_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_escalations grm_escalations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_escalations
    ADD CONSTRAINT grm_escalations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_google_accounts grm_google_accounts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_accounts
    ADD CONSTRAINT grm_google_accounts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.grm_google_connections(id) ON DELETE CASCADE;


--
-- Name: grm_google_accounts grm_google_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_accounts
    ADD CONSTRAINT grm_google_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_google_connections grm_google_connections_authorized_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_connections
    ADD CONSTRAINT grm_google_connections_authorized_by_user_id_fkey FOREIGN KEY (authorized_by_user_id) REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: grm_google_connections grm_google_connections_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_connections
    ADD CONSTRAINT grm_google_connections_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_google_connections grm_google_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_connections
    ADD CONSTRAINT grm_google_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_google_locations grm_google_locations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE RESTRICT;


--
-- Name: grm_google_locations grm_google_locations_google_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_google_account_id_fkey FOREIGN KEY (google_account_id) REFERENCES public.grm_google_accounts(id) ON DELETE CASCADE;


--
-- Name: grm_google_locations grm_google_locations_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_location_groups(id) ON DELETE SET NULL;


--
-- Name: grm_google_locations grm_google_locations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_google_locations
    ADD CONSTRAINT grm_google_locations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_groups grm_groups_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_groups
    ADD CONSTRAINT grm_groups_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.grm_brands(id) ON DELETE CASCADE;


--
-- Name: grm_groups grm_groups_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_groups
    ADD CONSTRAINT grm_groups_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_groups grm_groups_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_groups
    ADD CONSTRAINT grm_groups_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.grm_groups(id) ON DELETE RESTRICT;


--
-- Name: grm_groups grm_groups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_groups
    ADD CONSTRAINT grm_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_insight_reports grm_insight_reports_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_insight_reports grm_insight_reports_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;


--
-- Name: grm_insight_reports grm_insight_reports_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_insight_reports grm_insight_reports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_insight_reports
    ADD CONSTRAINT grm_insight_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_location_groups grm_location_groups_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_groups
    ADD CONSTRAINT grm_location_groups_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_location_groups grm_location_groups_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_groups
    ADD CONSTRAINT grm_location_groups_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.grm_location_groups(id) ON DELETE RESTRICT;


--
-- Name: grm_location_groups grm_location_groups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_groups
    ADD CONSTRAINT grm_location_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_location_managers grm_location_managers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_managers
    ADD CONSTRAINT grm_location_managers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_location_managers grm_location_managers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_managers
    ADD CONSTRAINT grm_location_managers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_location_tag_links grm_location_tag_links_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tag_links
    ADD CONSTRAINT grm_location_tag_links_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_location_tag_links grm_location_tag_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tag_links
    ADD CONSTRAINT grm_location_tag_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.grm_location_tags(id) ON DELETE CASCADE;


--
-- Name: grm_location_tags grm_location_tags_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_location_tags
    ADD CONSTRAINT grm_location_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_notifications grm_notifications_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_notifications
    ADD CONSTRAINT grm_notifications_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_notifications grm_notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_notifications
    ADD CONSTRAINT grm_notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_onboarding grm_onboarding_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_onboarding
    ADD CONSTRAINT grm_onboarding_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_platform_announcements grm_platform_announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_announcements
    ADD CONSTRAINT grm_platform_announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_platform_blocked_users grm_platform_blocked_users_blocked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_blocked_users
    ADD CONSTRAINT grm_platform_blocked_users_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_platform_blocked_users grm_platform_blocked_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_blocked_users
    ADD CONSTRAINT grm_platform_blocked_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_platform_invites grm_platform_invites_accepted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_invites
    ADD CONSTRAINT grm_platform_invites_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_platform_invites grm_platform_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_invites
    ADD CONSTRAINT grm_platform_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_platform_invites grm_platform_invites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_invites
    ADD CONSTRAINT grm_platform_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE SET NULL;


--
-- Name: grm_platform_settings grm_platform_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_platform_settings
    ADD CONSTRAINT grm_platform_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_reply_settings grm_reply_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_settings
    ADD CONSTRAINT grm_reply_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_reply_templates grm_reply_templates_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_templates
    ADD CONSTRAINT grm_reply_templates_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_reply_templates grm_reply_templates_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_templates
    ADD CONSTRAINT grm_reply_templates_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_groups(id) ON DELETE CASCADE;


--
-- Name: grm_reply_templates grm_reply_templates_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_templates
    ADD CONSTRAINT grm_reply_templates_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_reply_templates grm_reply_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reply_templates
    ADD CONSTRAINT grm_reply_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_report_deliveries grm_report_deliveries_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_deliveries
    ADD CONSTRAINT grm_report_deliveries_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.grm_report_runs(id) ON DELETE CASCADE;


--
-- Name: grm_report_deliveries grm_report_deliveries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_deliveries
    ADD CONSTRAINT grm_report_deliveries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_report_runs grm_report_runs_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_runs
    ADD CONSTRAINT grm_report_runs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.grm_report_schedules(id) ON DELETE SET NULL;


--
-- Name: grm_report_runs grm_report_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_runs
    ADD CONSTRAINT grm_report_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_report_schedules grm_report_schedules_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_report_schedules grm_report_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_report_schedules grm_report_schedules_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_location_groups(id) ON DELETE SET NULL;


--
-- Name: grm_report_schedules grm_report_schedules_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_report_schedules grm_report_schedules_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_report_schedules
    ADD CONSTRAINT grm_report_schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_reports grm_reports_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_reports grm_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id);


--
-- Name: grm_reports grm_reports_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_location_groups(id) ON DELETE SET NULL;


--
-- Name: grm_reports grm_reports_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_reports grm_reports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reports
    ADD CONSTRAINT grm_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_campaign_locations grm_request_campaign_locations_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_campaign_locations
    ADD CONSTRAINT grm_request_campaign_locations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.grm_request_campaigns(id) ON DELETE CASCADE;


--
-- Name: grm_request_campaign_locations grm_request_campaign_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_campaign_locations
    ADD CONSTRAINT grm_request_campaign_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_request_campaigns grm_request_campaigns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_campaigns
    ADD CONSTRAINT grm_request_campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_customers grm_request_customers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_customers
    ADD CONSTRAINT grm_request_customers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_request_customers grm_request_customers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_customers
    ADD CONSTRAINT grm_request_customers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_events grm_request_events_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_events
    ADD CONSTRAINT grm_request_events_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.grm_request_messages(id) ON DELETE CASCADE;


--
-- Name: grm_request_events grm_request_events_qr_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_events
    ADD CONSTRAINT grm_request_events_qr_id_fkey FOREIGN KEY (qr_id) REFERENCES public.grm_request_qr(id) ON DELETE CASCADE;


--
-- Name: grm_request_events grm_request_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_events
    ADD CONSTRAINT grm_request_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_feedback grm_request_feedback_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_feedback
    ADD CONSTRAINT grm_request_feedback_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_request_feedback grm_request_feedback_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_feedback
    ADD CONSTRAINT grm_request_feedback_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.grm_request_messages(id) ON DELETE SET NULL;


--
-- Name: grm_request_feedback grm_request_feedback_qr_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_feedback
    ADD CONSTRAINT grm_request_feedback_qr_id_fkey FOREIGN KEY (qr_id) REFERENCES public.grm_request_qr(id) ON DELETE SET NULL;


--
-- Name: grm_request_feedback grm_request_feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_feedback
    ADD CONSTRAINT grm_request_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_messages grm_request_messages_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.grm_request_campaigns(id) ON DELETE SET NULL;


--
-- Name: grm_request_messages grm_request_messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.grm_request_customers(id) ON DELETE SET NULL;


--
-- Name: grm_request_messages grm_request_messages_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_request_messages grm_request_messages_reminder_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_reminder_of_fkey FOREIGN KEY (reminder_of) REFERENCES public.grm_request_messages(id) ON DELETE SET NULL;


--
-- Name: grm_request_messages grm_request_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_messages
    ADD CONSTRAINT grm_request_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_policies grm_request_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_policies
    ADD CONSTRAINT grm_request_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_qr grm_request_qr_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_qr
    ADD CONSTRAINT grm_request_qr_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_request_qr grm_request_qr_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_qr
    ADD CONSTRAINT grm_request_qr_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_request_recipients grm_request_recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_recipients
    ADD CONSTRAINT grm_request_recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.grm_request_campaigns(id) ON DELETE CASCADE;


--
-- Name: grm_request_recipients grm_request_recipients_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_recipients
    ADD CONSTRAINT grm_request_recipients_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.grm_request_customers(id) ON DELETE CASCADE;


--
-- Name: grm_request_recipients grm_request_recipients_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_request_recipients
    ADD CONSTRAINT grm_request_recipients_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.grm_ai_generation_jobs(id) ON DELETE SET NULL;


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_review_ai_drafts grm_review_ai_drafts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_ai_drafts
    ADD CONSTRAINT grm_review_ai_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_review_analyses grm_review_analyses_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_analyses
    ADD CONSTRAINT grm_review_analyses_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_review_analyses grm_review_analyses_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_analyses
    ADD CONSTRAINT grm_review_analyses_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_review_analyses grm_review_analyses_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_analyses
    ADD CONSTRAINT grm_review_analyses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_review_notes grm_review_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_notes
    ADD CONSTRAINT grm_review_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_review_notes grm_review_notes_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_notes
    ADD CONSTRAINT grm_review_notes_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_review_notes grm_review_notes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_notes
    ADD CONSTRAINT grm_review_notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_review_observations grm_review_observations_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.grm_review_analyses(id) ON DELETE CASCADE;


--
-- Name: grm_review_observations grm_review_observations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_review_observations grm_review_observations_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;


--
-- Name: grm_review_observations grm_review_observations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_review_observations grm_review_observations_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_review_observations grm_review_observations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_observations
    ADD CONSTRAINT grm_review_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_review_replies grm_review_replies_ai_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_ai_draft_id_fkey FOREIGN KEY (ai_draft_id) REFERENCES public.grm_review_ai_drafts(id) ON DELETE SET NULL;


--
-- Name: grm_review_replies grm_review_replies_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_review_replies grm_review_replies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_created_by_fkey FOREIGN KEY (created_by) REFERENCES authn.users(id) ON DELETE RESTRICT;


--
-- Name: grm_review_replies grm_review_replies_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_published_by_fkey FOREIGN KEY (published_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_review_replies grm_review_replies_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.grm_reviews(id) ON DELETE CASCADE;


--
-- Name: grm_review_replies grm_review_replies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_review_replies
    ADD CONSTRAINT grm_review_replies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_reviews grm_reviews_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reviews
    ADD CONSTRAINT grm_reviews_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_reviews grm_reviews_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reviews
    ADD CONSTRAINT grm_reviews_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_reviews grm_reviews_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_reviews
    ADD CONSTRAINT grm_reviews_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_scope_settings grm_scope_settings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_scope_settings
    ADD CONSTRAINT grm_scope_settings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE CASCADE;


--
-- Name: grm_scope_settings grm_scope_settings_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_scope_settings
    ADD CONSTRAINT grm_scope_settings_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.grm_groups(id) ON DELETE CASCADE;


--
-- Name: grm_scope_settings grm_scope_settings_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_scope_settings
    ADD CONSTRAINT grm_scope_settings_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.grm_google_locations(id) ON DELETE CASCADE;


--
-- Name: grm_scope_settings grm_scope_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_scope_settings
    ADD CONSTRAINT grm_scope_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_usage_events grm_usage_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_usage_events
    ADD CONSTRAINT grm_usage_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_usage_events grm_usage_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_usage_events
    ADD CONSTRAINT grm_usage_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_user_consents grm_user_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_user_consents
    ADD CONSTRAINT grm_user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: grm_workspace_invites grm_workspace_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: grm_workspace_invites grm_workspace_invites_scope_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_scope_client_id_fkey FOREIGN KEY (scope_client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_invites grm_workspace_invites_scope_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_scope_group_id_fkey FOREIGN KEY (scope_group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_invites grm_workspace_invites_scope_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_scope_location_id_fkey FOREIGN KEY (scope_location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_invites grm_workspace_invites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_invites
    ADD CONSTRAINT grm_workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- Name: grm_workspace_members grm_workspace_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES authn.users(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_members grm_workspace_members_scope_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_scope_client_id_fkey FOREIGN KEY (scope_client_id) REFERENCES public.grm_clients(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_members grm_workspace_members_scope_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_scope_group_id_fkey FOREIGN KEY (scope_group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_members grm_workspace_members_scope_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_scope_location_id_fkey FOREIGN KEY (scope_location_id) REFERENCES public.grm_google_locations(id) ON DELETE SET NULL;


--
-- Name: grm_workspace_members grm_workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES authn.users(id) ON DELETE CASCADE;


--
-- Name: grm_workspace_members grm_workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grm_workspace_members
    ADD CONSTRAINT grm_workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.grm_workspaces(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
