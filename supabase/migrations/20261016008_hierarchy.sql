-- Brand, region, and city on the existing location groups.
-- A location keeps its id when it moves, so reviews stay attached.

alter table public.grm_location_groups
  add column if not exists client_id uuid references public.grm_clients(id) on delete cascade,
  add column if not exists parent_id uuid references public.grm_location_groups(id) on delete restrict,
  add column if not exists kind text not null default 'region';

alter table public.grm_location_groups drop constraint if exists grm_location_groups_kind_check;
alter table public.grm_location_groups
  add constraint grm_location_groups_kind_check check (kind in ('region', 'city'));

alter table public.grm_location_groups drop constraint if exists grm_location_groups_workspace_id_name_key;

create unique index if not exists grm_location_groups_name_scope
  on public.grm_location_groups (
    workspace_id,
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index if not exists grm_idx_location_groups_parent
  on public.grm_location_groups (parent_id);
create index if not exists grm_idx_location_groups_client
  on public.grm_location_groups (client_id);

create or replace function public.grm_guard_location_group()
returns trigger
language plpgsql
set search_path = public
as $$
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

drop trigger if exists trg_grm_guard_location_group on public.grm_location_groups;
create trigger trg_grm_guard_location_group
  before insert or update on public.grm_location_groups
  for each row execute function public.grm_guard_location_group();

create or replace function public.grm_guard_location_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
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

drop trigger if exists trg_grm_guard_location_assignment on public.grm_google_locations;
create trigger trg_grm_guard_location_assignment
  before insert or update of group_id, client_id, workspace_id on public.grm_google_locations
  for each row execute function public.grm_guard_location_assignment();

create table if not exists public.grm_location_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.grm_location_tag_links (
  location_id uuid not null references public.grm_google_locations(id) on delete cascade,
  tag_id uuid not null references public.grm_location_tags(id) on delete cascade,
  primary key (location_id, tag_id)
);

create table if not exists public.grm_location_managers (
  location_id uuid primary key references public.grm_google_locations(id) on delete cascade,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  user_id uuid not null
);

create table if not exists public.grm_scope_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  scope text not null check (scope in ('client', 'group', 'location')),
  client_id uuid references public.grm_clients(id) on delete cascade,
  group_id uuid references public.grm_location_groups(id) on delete cascade,
  location_id uuid references public.grm_google_locations(id) on delete cascade,
  tone_voice text check (tone_voice is null or tone_voice in ('warm', 'professional', 'brief')),
  tone_note text check (tone_note is null or char_length(tone_note) <= 500),
  sla_hours integer check (sla_hours is null or sla_hours between 1 and 168),
  routing_level text check (routing_level is null or routing_level in ('store', 'regional', 'leadership')),
  drafts_paused boolean,
  updated_at timestamptz not null default now(),
  check (
    (scope = 'client' and client_id is not null and group_id is null and location_id is null)
    or (scope = 'group' and group_id is not null and client_id is null and location_id is null)
    or (scope = 'location' and location_id is not null and client_id is null and group_id is null)
  )
);

create unique index if not exists grm_scope_settings_client
  on public.grm_scope_settings (workspace_id, client_id) where scope = 'client';
create unique index if not exists grm_scope_settings_group
  on public.grm_scope_settings (workspace_id, group_id) where scope = 'group';
create unique index if not exists grm_scope_settings_location
  on public.grm_scope_settings (workspace_id, location_id) where scope = 'location';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_grm_scope_settings_updated_at') then
    create trigger trg_grm_scope_settings_updated_at
      before update on public.grm_scope_settings
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_location_tags enable row level security;
alter table public.grm_location_tag_links enable row level security;
alter table public.grm_location_managers enable row level security;
alter table public.grm_scope_settings enable row level security;

drop policy if exists grm_location_tags_select on public.grm_location_tags;
create policy grm_location_tags_select on public.grm_location_tags
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_location_tag_links_select on public.grm_location_tag_links;
create policy grm_location_tag_links_select on public.grm_location_tag_links
  for select using (
    tag_id in (select id from public.grm_location_tags where workspace_id in (select public.grm_my_workspace_ids()))
  );

drop policy if exists grm_location_managers_select on public.grm_location_managers;
create policy grm_location_managers_select on public.grm_location_managers
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_scope_settings_select on public.grm_scope_settings;
create policy grm_scope_settings_select on public.grm_scope_settings
  for select using (workspace_id in (select public.grm_my_workspace_ids()));

create or replace function public.grm_location_in_group(p_group_id uuid, p_selected uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_selected is null
    or p_group_id = p_selected
    or exists (
      select 1 from public.grm_groups g
      where g.id = p_group_id and g.parent_id = p_selected
    );
$$;

revoke all on function public.grm_location_in_group(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grm_location_in_group(uuid, uuid) to service_role;

create or replace function public.grm_dashboard_bundle(
  p_workspace_id uuid,
  p_client_id uuid default null,
  p_group_id uuid default null,
  p_location_id uuid default null,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_timezone text default 'UTC'
)
returns jsonb
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


create or replace function public.grm_alert_location_window(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns jsonb
language sql
stable
set search_path = public
as $$
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
     and r.review_create_time >= p_start
     and r.review_create_time < p_end
    where l.workspace_id = p_workspace_id
      and (p_client_id is null or l.client_id = p_client_id)
      and public.grm_location_in_group(l.group_id, p_group_id)
      and (p_location_id is null or l.id = p_location_id)
    group by l.id, l.location_title
  ) x;
$$;

create or replace function public.grm_alert_keyword_reviews(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_keywords text[]
) returns jsonb
language sql
stable
set search_path = public
as $$
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
      and r.comment is not null
      and r.review_create_time >= p_start
      and r.review_create_time < p_end
      and (p_client_id is null or l.client_id = p_client_id)
      and (p_group_id is null or l.group_id = p_group_id)
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


create or replace function public.grm_alert_keyword_reviews(
  p_workspace_id uuid,
  p_client_id uuid,
  p_group_id uuid,
  p_location_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_keywords text[]
) returns jsonb
language sql
stable
set search_path = public
as $$
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

revoke all on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grm_alert_location_window(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  to service_role;


