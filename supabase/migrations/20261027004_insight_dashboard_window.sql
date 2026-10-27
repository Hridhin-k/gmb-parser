-- Insights dashboard spent generic-plan time on optional date predicates
-- written as (p_start is null or review_create_time >= p_start). On the local
-- bench (largest tenant 40,050 reviews) EXPLAIN of the counts statement under
-- force_generic_plan showed the date test as a Filter that removed 39,967 of
-- 40,050 rows, with ~40k shared buffer hits. The same statement under a custom
-- plan put the timestamps into the Index Cond (~0.4 ms, ~300 hits).
--
-- Nine follow-on statements each re-scanned grm_review_observations with the
-- same workspace/location/date window. This rewrite:
--   1. Uses coalesce(p_start, '-infinity') / coalesce(p_end, 'infinity') so a
--      null bound stays unbounded and a set bound is indexable.
--   2. Builds one MATERIALIZED observation set and derives stored counts,
--      topics, months, outlets, staff, and severe incidents from it.
-- Review counts stay a separate scan (different table and join). Response
-- JSON keys, severe regex, staff name canonicalization, and grants are
-- unchanged. No new indexes.
--
-- Rollback: re-apply public.grm_insight_dashboard from
-- 20261022011_insight_dashboard.sql.
-- Do not apply this to production until it has been reviewed.

create or replace function public.grm_insight_dashboard(
  p_workspace_id uuid,
  p_location_ids uuid[],
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_analysis_version text default 'obs-v1'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
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
  obs_bundle jsonb;
  harm_pattern text := '\y(injur|hurt|bleed|blood|sick|vomit|food poison|contaminat|hair in|insect|cockroach|rat|discriminat|racist|caste|harass|abuse|threat|cheat|fraud|scam|stole|theft|police|legal|consumer court|unsafe|dangerous|allergy|hospital)\y';
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
      and r.review_create_time >= coalesce(p_start, '-infinity'::timestamptz)
      and r.review_create_time < coalesce(p_end, 'infinity'::timestamptz)
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

  with scoped_obs as materialized (
    select
      o.review_id,
      o.location_id,
      o.topic,
      o.sentiment,
      o.severity,
      o.star_rating,
      o.review_create_time,
      o.evidence_excerpt,
      o.severity_rationale,
      o.entity_type,
      o.entity_name,
      (
        o.sentiment = 'negative'
        and (
          coalesce(o.severity, 0) >= 4
          or o.evidence_excerpt ~* harm_pattern
        )
      ) as severe
    from public.grm_review_observations o
    join public.grm_review_analyses a
      on a.id = o.analysis_id
     and a.status = 'ready'
    where o.workspace_id = p_workspace_id
      and o.location_id = any (p_location_ids)
      and o.review_create_time >= coalesce(p_start, '-infinity'::timestamptz)
      and o.review_create_time < coalesce(p_end, 'infinity'::timestamptz)
  ),
  positive as (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.topic asc), '[]'::jsonb) as payload
    from (
      select topic, count(*)::int as count, count(distinct review_id)::int as reviews
      from scoped_obs
      where sentiment = 'positive'
      group by topic
      order by count(*) desc, topic asc
    ) t
  ),
  negative as (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.topic asc), '[]'::jsonb) as payload
    from (
      select topic, count(*)::int as count, count(distinct review_id)::int as reviews
      from scoped_obs
      where sentiment = 'negative'
      group by topic
      order by count(*) desc, topic asc
    ) t
  ),
  by_month as (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.month), '[]'::jsonb) as payload
    from (
      select
        to_char(review_create_time at time zone 'UTC', 'YYYY-MM') as month,
        count(*) filter (where sentiment = 'positive')::int as positive,
        count(*) filter (where sentiment = 'negative')::int as negative
      from scoped_obs
      group by 1
    ) t
  ),
  by_outlet as (
    select coalesce(
      jsonb_agg(row_to_json(t)::jsonb order by t.negative desc, t.positive desc),
      '[]'::jsonb
    ) as payload
    from (
      select
        location_id as "locationId",
        count(*) filter (where sentiment = 'positive')::int as positive,
        count(*) filter (where sentiment = 'negative')::int as negative,
        count(*) filter (where severe)::int as severe
      from scoped_obs
      group by location_id
      order by count(*) filter (where sentiment = 'negative') desc,
               count(*) filter (where sentiment = 'positive') desc
    ) t
  ),
  outlet_reviews as (
    select coalesce(jsonb_object_agg(location_id, n), '{}'::jsonb) as payload
    from (
      select location_id, count(distinct review_id)::int as n
      from scoped_obs
      group by location_id
    ) s
  ),
  staff_praise as (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.name asc), '[]'::jsonb) as payload
    from (
      select
        (array_agg(
          regexp_replace(btrim(entity_name), '\s+', ' ', 'g')
          order by
            (regexp_replace(btrim(entity_name), '\s+', ' ', 'g') <> lower(regexp_replace(btrim(entity_name), '\s+', ' ', 'g'))) desc,
            regexp_replace(btrim(entity_name), '\s+', ' ', 'g')
        ))[1] as name,
        count(*)::int as count
      from scoped_obs
      where sentiment = 'positive'
        and entity_type = 'staff'
        and btrim(coalesce(entity_name, '')) <> ''
      group by lower(regexp_replace(btrim(entity_name), '\s+', ' ', 'g'))
      order by count(*) desc, name asc
    ) t
  ),
  staff_complaints as (
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count desc, t.name asc), '[]'::jsonb) as payload
    from (
      select
        (array_agg(
          regexp_replace(btrim(entity_name), '\s+', ' ', 'g')
          order by
            (regexp_replace(btrim(entity_name), '\s+', ' ', 'g') <> lower(regexp_replace(btrim(entity_name), '\s+', ' ', 'g'))) desc,
            regexp_replace(btrim(entity_name), '\s+', ' ', 'g')
        ))[1] as name,
        count(*)::int as count
      from scoped_obs
      where sentiment = 'negative'
        and entity_type = 'staff'
        and btrim(coalesce(entity_name, '')) <> ''
      group by lower(regexp_replace(btrim(entity_name), '\s+', ' ', 'g'))
      order by count(*) desc, name asc
    ) t
  ),
  severe_incidents as (
    select coalesce(
      jsonb_agg(
        row_to_json(t)::jsonb
        order by coalesce(t.severity, 0) desc, t."reviewCreateTime" asc
      ),
      '[]'::jsonb
    ) as payload
    from (
      select
        review_id as "reviewId",
        severity,
        star_rating as "starRating",
        review_create_time as "reviewCreateTime",
        evidence_excerpt as "evidenceExcerpt",
        severity_rationale as "severityRationale"
      from scoped_obs
      where severe
      order by coalesce(severity, 0) desc, review_create_time asc
      limit 10
    ) t
  )
  select jsonb_build_object(
    'storedObservations', (select count(*)::int from scoped_obs),
    'reviewsAnalysed', (select count(distinct review_id)::int from scoped_obs),
    'severeCount', (select count(*) filter (where severe)::int from scoped_obs),
    'positive', (select payload from positive),
    'negative', (select payload from negative),
    'byMonth', (select payload from by_month),
    'byOutlet', (select payload from by_outlet),
    'outletReviews', (select payload from outlet_reviews),
    'staffPraise', (select payload from staff_praise),
    'staffComplaints', (select payload from staff_complaints),
    'severeIncidents', (select payload from severe_incidents)
  )
  into obs_bundle;

  return jsonb_build_object(
    'counts', coalesce(counts, empty_counts),
    'reviewsAnalysed', coalesce((obs_bundle ->> 'reviewsAnalysed')::int, 0),
    'storedObservations', coalesce((obs_bundle ->> 'storedObservations')::int, 0),
    'severeCount', coalesce((obs_bundle ->> 'severeCount')::int, 0),
    'positive', coalesce(obs_bundle -> 'positive', '[]'::jsonb),
    'negative', coalesce(obs_bundle -> 'negative', '[]'::jsonb),
    'byMonth', coalesce(obs_bundle -> 'byMonth', '[]'::jsonb),
    'byOutlet', coalesce(obs_bundle -> 'byOutlet', '[]'::jsonb),
    'outletReviews', coalesce(obs_bundle -> 'outletReviews', '{}'::jsonb),
    'staffPraise', coalesce(obs_bundle -> 'staffPraise', '[]'::jsonb),
    'staffComplaints', coalesce(obs_bundle -> 'staffComplaints', '[]'::jsonb),
    'severeIncidents', coalesce(obs_bundle -> 'severeIncidents', '[]'::jsonb)
  );
end;
$$;

comment on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) is
  'Counts and chart aggregates for the insights page. Replaces downloading every review and observation into the app server.';

revoke all on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) to service_role;
