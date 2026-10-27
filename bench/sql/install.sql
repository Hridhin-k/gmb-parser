-- RevuPilot bench schema. Apply only to a dedicated local or staging database.
-- Identifiers are bench-* slugs and bench/ review names. Connections are revoked
-- so the review-sync cron will not select them.
-- Review text and observation evidence are copied from bench.phrases.
-- This file performs no HTTP call and reads no model credential.

create schema if not exists bench;

create table if not exists bench.runs (
  seed integer primary key,
  analyses text not null,
  sample_percent integer not null,
  next_review bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists bench.tenants (
  seed integer not null,
  tenant_index integer not null,
  workspace_id uuid not null,
  review_offset bigint not null,
  review_count bigint not null,
  locations jsonb not null,
  primary key (seed, tenant_index)
);

create table if not exists bench.phrases (
  id integer primary key,
  body text not null
);

create or replace function bench.assert_bench_workspace(p_workspace uuid)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.grm_workspaces
    where id = p_workspace
      and slug like 'bench-%'
  ) then
    raise exception 'bench: refusing to write outside a bench workspace';
  end if;
end;
$$;

create or replace function bench.seed_catalog(p_plan jsonb)
returns void
language plpgsql
as $$
declare
  v_seed integer := (p_plan->>'seed')::integer;
  v_user uuid := (p_plan->>'userId')::uuid;
  v_tenant jsonb;
  v_client jsonb;
  v_location jsonb;
  v_phrase jsonb;
  v_index integer := 0;
  v_group uuid;
begin
  if to_regclass('public.grm_reviews') is null then
    raise exception 'bench: grm_reviews is missing. Apply the application migrations first.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'bench: auth.users is missing. Use a Supabase Postgres, not a bare database without the auth schema.';
  end if;
  if exists (
    select 1 from public.grm_reviews
    where google_review_name not like 'bench/%'
  ) then
    raise exception 'bench: this database already has non-bench reviews. Refusing to mix fixture data with them.';
  end if;

  -- Hosted GoTrue names the column email_confirmed_at. The local image used
  -- for this bench still has confirmed_at. Write whichever column exists.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at'
  ) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    select
      '00000000-0000-0000-0000-000000000000',
      v_user,
      'authenticated',
      'authenticated',
      'bench-loadtest@example.invalid',
      'bench-not-a-password',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    where not exists (
      select 1 from auth.users
      where id = v_user or email = 'bench-loadtest@example.invalid'
    );
  else
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    select
      '00000000-0000-0000-0000-000000000000',
      v_user,
      'authenticated',
      'authenticated',
      'bench-loadtest@example.invalid',
      'bench-not-a-password',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    where not exists (
      select 1 from auth.users
      where id = v_user or email = 'bench-loadtest@example.invalid'
    );
  end if;

  delete from bench.phrases;
  for v_phrase in select value from jsonb_array_elements(p_plan->'phrases')
  loop
    v_index := v_index + 1;
    insert into bench.phrases (id, body) values (v_index, v_phrase #>> '{}');
  end loop;

  insert into bench.runs (seed, analyses, sample_percent)
  values (v_seed, p_plan->>'analyses', (p_plan->>'samplePercent')::integer)
  on conflict (seed) do update
    set analyses = excluded.analyses,
        sample_percent = excluded.sample_percent;

  for v_tenant in select value from jsonb_array_elements(p_plan->'rows')
  loop
    if (v_tenant->>'workspaceId') is null or (p_plan->>'seed') is null then
      raise exception 'bench: plan row is missing a workspace id';
    end if;

    insert into public.grm_workspaces (id, name, slug)
    values (
      (v_tenant->>'workspaceId')::uuid,
      'Bench tenant ' || (v_tenant->>'index'),
      'bench-' || v_seed || '-' || lpad(v_tenant->>'index', 4, '0')
    ) on conflict (id) do nothing;

    insert into public.grm_workspace_members (workspace_id, user_id, role)
    values ((v_tenant->>'workspaceId')::uuid, v_user, 'owner')
    on conflict (workspace_id, user_id) do nothing;

    for v_client in select value from jsonb_array_elements(v_tenant->'clients')
    loop
      insert into public.grm_clients (id, workspace_id, name)
      values (
        (v_client->>'clientId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        'Bench client ' || substr(v_client->>'clientId', 1, 8)
      ) on conflict (id) do nothing;

      insert into public.grm_brands (id, workspace_id, client_id, name)
      values (
        (v_client->>'brandId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        (v_client->>'clientId')::uuid,
        'Bench brand'
      ) on conflict (id) do nothing;

      insert into public.grm_groups (id, workspace_id, client_id, brand_id, name, kind)
      values (
        (v_client->>'regionId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        (v_client->>'clientId')::uuid,
        (v_client->>'brandId')::uuid,
        'Bench region ' || substr(v_client->>'regionId', 1, 8),
        'region'
      ) on conflict (id) do nothing;

      insert into public.grm_groups (id, workspace_id, client_id, brand_id, parent_id, name, kind)
      values (
        (v_client->>'cityId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        (v_client->>'clientId')::uuid,
        (v_client->>'brandId')::uuid,
        (v_client->>'regionId')::uuid,
        'Bench city ' || substr(v_client->>'cityId', 1, 8),
        'city'
      ) on conflict (id) do nothing;

      insert into public.grm_location_groups (id, workspace_id, name, source, client_id, kind)
      values (
        (v_client->>'regionId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        'Bench region ' || substr(v_client->>'regionId', 1, 8),
        'manual',
        (v_client->>'clientId')::uuid,
        'region'
      ) on conflict (id) do nothing;

      insert into public.grm_location_groups (id, workspace_id, name, source, client_id, parent_id, kind)
      values (
        (v_client->>'cityId')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        'Bench city ' || substr(v_client->>'cityId', 1, 8),
        'manual',
        (v_client->>'clientId')::uuid,
        (v_client->>'regionId')::uuid,
        'city'
      ) on conflict (id) do nothing;
    end loop;

    insert into public.grm_google_connections (
      id, workspace_id, authorized_by_user_id, google_email,
      access_token_enc, refresh_token_enc, token_expires_at, scopes, status
    ) values (
      (v_tenant->>'connectionId')::uuid,
      (v_tenant->>'workspaceId')::uuid,
      v_user,
      'bench-synthetic@example.invalid',
      'bench-not-a-token',
      'bench-not-a-token',
      now() + interval '1 day',
      array['bench-placeholder']::text[],
      'revoked'
    ) on conflict (id) do nothing;

    insert into public.grm_google_accounts (
      id, workspace_id, connection_id, google_account_name, account_display_name, account_type
    ) values (
      (v_tenant->>'accountId')::uuid,
      (v_tenant->>'workspaceId')::uuid,
      (v_tenant->>'connectionId')::uuid,
      'bench/accounts/' || v_seed || '/' || (v_tenant->>'index'),
      'Bench account',
      'LOCATION_GROUP'
    ) on conflict (id) do nothing;

    for v_location in select value from jsonb_array_elements(v_tenant->'locationRows')
    loop
      v_group := (v_location->>'groupId')::uuid;
      insert into public.grm_google_locations (
        id, workspace_id, client_id, google_account_id, google_location_name,
        location_title, group_id, sync_status, reviews_full_synced_at, is_active
      ) values (
        (v_location->>'id')::uuid,
        (v_tenant->>'workspaceId')::uuid,
        (v_location->>'clientId')::uuid,
        (v_tenant->>'accountId')::uuid,
        'bench/accounts/' || v_seed || '/t' || lpad(v_tenant->>'index', 4, '0') || '/locations/' || substr(v_location->>'id', 1, 8),
        'Bench location ' || substr(v_location->>'id', 1, 8),
        v_group,
        'success',
        now(),
        true
      ) on conflict (id) do nothing;
    end loop;

    insert into bench.tenants (seed, tenant_index, workspace_id, review_offset, review_count, locations)
    values (
      v_seed,
      (v_tenant->>'index')::integer,
      (v_tenant->>'workspaceId')::uuid,
      (v_tenant->>'reviewOffset')::bigint,
      (v_tenant->>'reviews')::bigint,
      v_tenant->'locationRows'
    ) on conflict (seed, tenant_index) do update
      set review_count = excluded.review_count,
          locations = excluded.locations;

    insert into public.grm_insight_reports (
      workspace_id, cache_key, client_id, location_ids, status, phase,
      insights, evidence_summary, data_fingerprint, analysis_version, prompt_version, model,
      discovered_count, eligible_count, analysed_count
    ) values (
      (v_tenant->>'workspaceId')::uuid,
      'bench:' || v_seed || ':' || (v_tenant->>'index'),
      (v_tenant->'clients'->0->>'clientId')::uuid,
      coalesce((
        select jsonb_agg(value->>'id')
        from jsonb_array_elements(v_tenant->'locationRows')
      ), '[]'::jsonb),
      'completed',
      'reused',
      jsonb_build_array(jsonb_build_object(
        'title', 'Bench fixture insight',
        'severity', 'low',
        'summary', 'Synthetic report generated for the load test. It cites no customer review.'
      )),
      '{"source":"revupilot-bench"}'::jsonb,
      'bench-fingerprint',
      'obs-v1',
      'bench-1',
      'bench-mock',
      (v_tenant->>'reviews')::integer,
      0,
      0
    ) on conflict (workspace_id, cache_key) do nothing;
  end loop;
end;
$$;

create or replace function bench.insert_review_batch(
  p_seed integer,
  p_tenant integer,
  p_from bigint,
  p_to bigint
)
returns integer
language plpgsql
as $$
declare
  v_workspace uuid;
  v_locations jsonb;
  v_count integer;
  v_phrases integer;
  v_analyses text;
  v_sample integer;
begin
  select workspace_id, locations
    into v_workspace, v_locations
  from bench.tenants
  where seed = p_seed and tenant_index = p_tenant;
  if v_workspace is null then
    raise exception 'bench: unknown tenant % for seed %', p_tenant, p_seed;
  end if;
  perform bench.assert_bench_workspace(v_workspace);

  select analyses, sample_percent into v_analyses, v_sample from bench.runs where seed = p_seed;
  select count(*) into v_phrases from bench.phrases;

  with series as (
    select n
    from generate_series(p_from, p_to) as n
  ),
  shaped as (
    select
      n,
      decode(md5(p_seed::text || ':' || p_tenant::text || ':' || n::text), 'hex') as raw,
      (
        select value
        from jsonb_array_elements(v_locations) with ordinality as loc(value, ord)
        where ord = (n % jsonb_array_length(v_locations)) + 1
      ) as location
    from series
  ),
  ready as (
    select
      n,
      (location->>'id')::uuid as location_id,
      (location->>'clientId')::uuid as client_id,
      (location->>'groupId')::uuid as group_id,
      (array[1, 2, 3, 3, 4, 4, 4, 5, 5, 5])[1 + (get_byte(raw, 0) % 10)] as stars,
      case
        when get_byte(raw, 5) % 100 < 37 then (
          select string_agg(body, ' ' order by id)
          from (
            select id, body
            from bench.phrases
            order by id
            offset (get_byte(raw, 2) % v_phrases)
            limit 1 + (get_byte(raw, 6) % 4) * 2
          ) phrase
        )
        else null
      end as comment,
      timestamptz '2022-01-01 00:00:00+00'
        + (((get_byte(raw, 1)::int * 256 + get_byte(raw, 3)::int) % 1734) || ' days')::interval
        + (((get_byte(raw, 4)::int * 256 + get_byte(raw, 7)::int) % 86400) || ' seconds')::interval
        as created_at,
      (get_byte(raw, 4) % 16 = 0) as edited
    from shaped
  ),
  stamped as (
    select
      *,
      case when edited then created_at + interval '2 days' else created_at end as updated_at,
      case
        when get_byte(decode(md5(n::text), 'hex'), 0) % 100 >= 98 then 'failed'
        when get_byte(decode(md5(n::text), 'hex'), 0) % 100 >= 97 then 'draft'
        when get_byte(decode(md5(n::text), 'hex'), 0) % 100 >= 90 then 'published'
        else 'none'
      end::public.grm_reply_status as reply_status
    from ready
  ),
  upserted as (
    insert into public.grm_reviews (
      workspace_id, location_id, google_review_name, google_review_id,
      reviewer_display_name, reviewer_is_anonymous, star_rating, comment,
      review_create_time, review_update_time, google_reply_comment, google_reply_update_time,
      reply_status, content_fingerprint, review_language, complaint_theme
    )
    select
      v_workspace,
      location_id,
      'bench/' || p_seed || '/t' || lpad(p_tenant::text, 4, '0') || '/r' || lpad(n::text, 12, '0'),
      'bench-' || p_seed || '-' || p_tenant || '-' || n,
      'Guest ' || (n % 500),
      (n % 17 = 0),
      stars,
      comment,
      created_at,
      updated_at,
      case when reply_status = 'published' then 'Bench fixture reply.' else null end,
      case when reply_status = 'published' then updated_at else null end,
      reply_status,
      md5(stars::text || '|' || coalesce(comment, '') || '|' || to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      case when comment is null then 'none' else 'en' end,
      case when stars <= 3 then (array['queue', 'staff', 'cleanliness'])[1 + (n % 3)] else null end
    from stamped
    on conflict (workspace_id, google_review_name) do nothing
    returning id, location_id, comment, star_rating, review_create_time, content_fingerprint, reply_status, google_review_name
  ),
  analysed as (
    insert into public.grm_review_analyses (
      workspace_id, review_id, location_id, analysis_version, content_fingerprint,
      status, model, observation_count, processed_at
    )
    select
      v_workspace, id, location_id, 'obs-v1', content_fingerprint,
      'ready', 'bench-mock', 1, now()
    from upserted
    where comment is not null
      and v_analyses <> 'none'
      and (
        v_analyses = 'full'
        or (get_byte(decode(md5(google_review_name), 'hex'), 0) % 100) < v_sample
      )
    on conflict (review_id, analysis_version) do nothing
    returning id, review_id, location_id, content_fingerprint
  ),
  observed as (
    insert into public.grm_review_observations (
      workspace_id, analysis_id, review_id, location_id, client_id, group_id,
      review_create_time, star_rating, language, topic, sentiment, detail,
      severity, evidence_excerpt, basis, confidence, dedupe_key
    )
    select
      v_workspace,
      a.id,
      u.id,
      u.location_id,
      (
        select (value->>'clientId')::uuid
        from jsonb_array_elements(v_locations)
        where value->>'id' = u.location_id::text
        limit 1
      ),
      (
        select (value->>'groupId')::uuid
        from jsonb_array_elements(v_locations)
        where value->>'id' = u.location_id::text
        limit 1
      ),
      u.review_create_time,
      u.star_rating,
      'en',
      case when u.star_rating >= 4 then 'staff_politeness' else 'queue_time' end,
      case when u.star_rating >= 4 then 'positive' when u.star_rating <= 2 then 'negative' else 'neutral' end,
      'Synthetic observation for a fixture review.',
      case when u.star_rating <= 2 then 4 else 1 end,
      u.comment,
      'fact',
      0.90,
      'bench-primary'
    from analysed a
    join upserted u on u.id = a.review_id
    on conflict (analysis_id, dedupe_key) do nothing
    returning 1
  ),
  replied as (
    insert into public.grm_review_replies (
      workspace_id, review_id, content, source, status, created_by, published_at
    )
    select
      v_workspace, id, 'Bench fixture reply.', 'manual', 'published',
      (select id from auth.users where email = 'bench-loadtest@example.invalid' limit 1),
      review_create_time
    from upserted
    where reply_status = 'published'
      and not exists (
        select 1 from public.grm_review_replies existing
        where existing.review_id = upserted.id
          and existing.status in ('draft', 'approved', 'pending_publish', 'published')
      )
    returning 1
  )
  select count(*) into v_count from upserted;

  update bench.runs
    set next_review = greatest(next_review, (select review_offset from bench.tenants where seed = p_seed and tenant_index = p_tenant) + p_to + 1)
  where seed = p_seed;

  return v_count;
end;
$$;

create or replace function bench.upsert_batch(p_workspace uuid, p_location uuid, p_seed integer, p_tenant integer)
returns jsonb
language plpgsql
as $$
declare
  v_names text[];
  v_count integer;
begin
  perform bench.assert_bench_workspace(p_workspace);
  select array_agg(
    'bench/' || p_seed || '/t' || lpad(p_tenant::text, 4, '0') || '/ingest/' || lpad(g::text, 4, '0')
  )
  into v_names
  from generate_series(1, 20) as g;

  insert into public.grm_reviews (
    workspace_id, location_id, google_review_name, google_review_id,
    reviewer_display_name, star_rating, comment, review_create_time, reply_status,
    content_fingerprint, review_language
  )
  select
    p_workspace,
    p_location,
    name,
    'ingest-' || name,
    'Guest ingest',
    5,
    'Synthetic ingest row for the duplicate drill.',
    timestamptz '2024-06-01 00:00:00+00',
    'none',
    md5(name),
    'en'
  from unnest(v_names) as name
  on conflict (workspace_id, google_review_name) do update
    set last_synced_at = now();

  select count(*) into v_count
  from public.grm_reviews
  where workspace_id = p_workspace
    and google_review_name = any (v_names);

  return jsonb_build_object('rows', v_count, 'expected', 20, 'duplicate_extra', v_count - 20);
end;
$$;

create or replace function bench.drill_fail_stale(p_workspace uuid)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
  v_status text;
begin
  perform bench.assert_bench_workspace(p_workspace);
  insert into public.grm_analysis_runs (workspace_id, status, started_at, updated_at)
  values (p_workspace, 'running', now() - interval '10 minutes', now() - interval '10 minutes')
  returning id into v_id;

  update public.grm_analysis_runs
    set status = 'failed',
        error = 'revupilot-bench: interrupted drill. Completed fixture reviews stay reusable.',
        finished_at = now()
  where id = v_id
    and workspace_id = p_workspace
    and status = 'running'
    and updated_at < now() - interval '5 minutes';

  select status into v_status from public.grm_analysis_runs where id = v_id;
  return jsonb_build_object('id', v_id, 'status', v_status, 'stuck', v_status = 'running');
end;
$$;

create or replace function bench.drill_claim(p_workspace uuid)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
  v_claimed integer;
  v_status text;
begin
  perform bench.assert_bench_workspace(p_workspace);
  insert into public.grm_analysis_runs (workspace_id, status, started_at, updated_at)
  values (p_workspace, 'running', now() - interval '10 minutes', now() - interval '10 minutes')
  returning id into v_id;

  with claimed as (
    update public.grm_analysis_runs
      set updated_at = now()
    where id = v_id
      and workspace_id = p_workspace
      and status = 'running'
      and updated_at < now() - interval '20 seconds'
    returning id
  )
  select count(*) into v_claimed from claimed;

  update public.grm_analysis_runs
    set status = 'failed',
        error = 'revupilot-bench: claim drill closed so the row cannot stay running.',
        finished_at = now()
  where id = v_id;

  select status into v_status from public.grm_analysis_runs where id = v_id;
  return jsonb_build_object('claimed', v_claimed, 'status', v_status, 'stuck', v_status = 'running');
end;
$$;

-- Caller must ROLLBACK. The update is how the stale-analysis trigger is timed.
create or replace function bench.drill_invalidate(p_workspace uuid)
returns jsonb
language plpgsql
as $$
declare
  v_review uuid;
  v_before text;
  v_after text;
begin
  perform bench.assert_bench_workspace(p_workspace);
  select r.id into v_review
  from public.grm_reviews r
  join public.grm_review_analyses a on a.review_id = r.id and a.status = 'ready'
  where r.workspace_id = p_workspace
    and r.google_review_name like 'bench/%'
  limit 1;

  if v_review is null then
    return jsonb_build_object('skipped', true, 'reason', 'no ready fixture analysis');
  end if;

  select status into v_before
  from public.grm_review_analyses
  where review_id = v_review and status = 'ready'
  limit 1;

  update public.grm_reviews
    set comment = comment || ' bench-edit'
  where id = v_review
    and workspace_id = p_workspace
    and google_review_name like 'bench/%';

  select status into v_after
  from public.grm_review_analyses
  where review_id = v_review
  order by updated_at desc
  limit 1;

  return jsonb_build_object('skipped', false, 'before', v_before, 'after', v_after, 'reviewId', v_review);
end;
$$;

create or replace function bench.cleanup_seed(p_seed integer)
returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  if exists (
    select 1
    from public.grm_workspaces w
    join public.grm_reviews r on r.workspace_id = w.id
    where w.slug like 'bench-' || p_seed || '-%'
      and r.google_review_name not like 'bench/%'
  ) then
    raise exception 'bench: a bench slug owns a non-bench review. Refusing cleanup.';
  end if;

  delete from public.grm_workspaces
  where slug like 'bench-' || p_seed || '-%'
    and name like 'Bench tenant %';
  get diagnostics v_deleted = row_count;

  delete from bench.tenants where seed = p_seed;
  delete from bench.runs where seed = p_seed;
  return v_deleted;
end;
$$;
