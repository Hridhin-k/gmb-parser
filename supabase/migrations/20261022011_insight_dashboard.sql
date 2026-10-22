-- Insights page aggregates.
--
-- The page used to download every review and every observation (1,000-row
-- pages, full comment and excerpt text) into the server function and count
-- them in Node. On a real workspace that outlived the function, so the
-- browser saw a closed connection ("Unable to load this page" / network
-- error) instead of the page. These counts are computed in Postgres and
-- only a small JSON summary is returned.
--
-- The harm pattern matches HARM_TERMS in lib/review-intelligence.ts.
-- Reverse: drop function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text);

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

comment on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) is
  'Counts and chart aggregates for the insights page. Replaces downloading every review and observation into the app server.';

revoke all on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grm_insight_dashboard(uuid, uuid[], timestamptz, timestamptz, text) to service_role;
