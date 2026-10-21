-- =============================================================================
-- Performance: aggregate star counts in Postgres + indexes for the hot
-- navigation counts. The dashboard previously downloaded up to 25,000 review
-- rows (in sequential 1,000-row pages) just to count stars per chart slice.
-- Reverse: drop function public.grm_star_breakdown; drop the indexes below.
-- =============================================================================

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
    and r.location_id = any (p_location_ids)
    and (p_start is null or r.review_create_time >= p_start)
    and (p_end is null or r.review_create_time < p_end)
  group by 1, 2, 3, 4
$$;

comment on function public.grm_star_breakdown(uuid, uuid[], timestamptz, timestamptz, text) is
  'Star-rating counts per month (workspace timezone) / location / theme for dashboard charts. Replaces downloading review rows to count them in the app.';

-- Portfolio (agency home) counts: per-location published replies (in the
-- selected window), replies awaiting client approval, open escalations, and
-- per-client usage events. The page previously downloaded every reply, event,
-- escalation and review id in the workspace to count these in the app.
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

comment on function public.grm_agency_counts(uuid, timestamptz, timestamptz) is
  'Per-location/per-client activity counts for the agency portfolio page. Replaces downloading reply/event/escalation/review rows to count them in the app.';

-- Sidebar badge counts filter escalations by workspace + open status on every page.
create index if not exists grm_idx_escalations_workspace_status
  on public.grm_escalations (workspace_id, status);

-- Scoped counts and the overview "oldest overdue" lookup filter by location too.
create index if not exists grm_idx_escalations_workspace_location_status
  on public.grm_escalations (workspace_id, location_id, status);

-- Inbox and scoped review lists: workspace + a set of locations, newest first.
create index if not exists grm_idx_reviews_workspace_location_time
  on public.grm_reviews (workspace_id, location_id, review_create_time desc);
