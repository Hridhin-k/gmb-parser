-- Sidebar profile attention counts.
--
-- The dashboard layout used to download every unreplied/draft/failed review
-- row and every open escalation row (1,000-row pages, up to 20,000 rows per
-- 150 locations) into the app server just to count them per location. That
-- ran on every page, navigation and refresh for scoped users. Counts are
-- computed here instead; only locations needing attention are returned.
--
-- Reverse: drop function public.grm_shell_profile_attention(uuid, uuid[]);

create or replace function public.grm_shell_profile_attention(
  p_workspace_id uuid,
  p_location_ids uuid[]
)
returns jsonb
language sql
stable
set search_path = public
as $$
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

comment on function public.grm_shell_profile_attention(uuid, uuid[]) is
  'Per-location attention counts for the dashboard sidebar. Replaces downloading review/escalation rows to count them in the app.';

revoke all on function public.grm_shell_profile_attention(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.grm_shell_profile_attention(uuid, uuid[]) to service_role;
