-- Assertions for the review intelligence migration. Raises on failure.

do $$
declare
  ws_a uuid := '11111111-1111-4111-8111-111111111111';
  ws_b uuid := '22222222-2222-4222-8222-222222222222';
  user_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  user_store uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  user_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  client_a uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  client_b uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  group_a uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  loc_a uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  loc_b uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  review_a uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  review_b uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff2';
  intel_a uuid;
  topic_id uuid;
  summary_all uuid;
  summary_year uuid;
  summary_group uuid;
  summary_loc uuid;
  report_row uuid;
  seen int;
  plan text;
begin
  insert into grm_workspaces values (ws_a, 'A', 'a'), (ws_b, 'B', 'b');
  insert into grm_clients values (client_a, ws_a, 'Org A'), (client_b, ws_b, 'Org B');
  insert into grm_groups values (group_a, ws_a, client_a, null, 'Region', 'region');
  insert into grm_google_locations values
    (loc_a, ws_a, client_a, group_a),
    (loc_b, ws_b, client_b, null);
  insert into grm_reviews values
    (review_a, ws_a, loc_a, 'Billing queue was slow', 'hash-a-001', 2, '2026-03-01T00:00:00Z', 'accounts/a/locations/a/reviews/1', '1'),
    (review_b, ws_b, loc_b, 'Other tenant review', 'hash-b-001', 5, '2026-03-02T00:00:00Z', 'accounts/b/locations/b/reviews/1', '1');
  insert into grm_workspace_members (workspace_id, user_id, access_enabled) values
    (ws_a, user_a, true),
    (ws_b, user_b, true);
  insert into grm_workspace_members (workspace_id, user_id, access_enabled, scope_location_id) values
    (ws_a, user_store, true, loc_a);

  insert into grm_review_intelligence (
    workspace_id, review_id, location_id, content_hash, analysis_version, taxonomy_version,
    prompt_version, model, sentiment, status, is_current
  ) values (
    ws_a, review_a, loc_a, 'hash-a-001', 'analysis-v1', 'taxonomy-v1', 'prompt-v1', 'rules', 'negative', 'ready', true
  ) returning id into intel_a;

  begin
    insert into grm_review_intelligence (
      workspace_id, review_id, location_id, content_hash, analysis_version, taxonomy_version,
      prompt_version, model, sentiment, status, is_current
    ) values (
      ws_a, review_a, loc_a, 'hash-a-001', 'analysis-v1', 'taxonomy-v1', 'prompt-v1', 'rules', 'negative', 'ready', false
    );
    raise exception 'duplicate content version was inserted';
  exception when unique_violation then
    null;
  end;

  begin
    insert into grm_review_intelligence (
      workspace_id, review_id, location_id, content_hash, analysis_version, taxonomy_version,
      prompt_version, model, sentiment, status
    ) values (
      ws_b, review_a, loc_a, 'hash-a-002', 'analysis-v1', 'taxonomy-v1', 'prompt-v1', 'rules', 'negative', 'ready'
    );
    raise exception 'cross-tenant intelligence was inserted';
  exception when others then
    if sqlerrm not like '%another workspace%' and sqlerrm not like '%must match%' then
      raise;
    end if;
  end;

  select id into topic_id from grm_topics
  where workspace_id is null and code = 'billing' and kind = 'issue' and taxonomy_version = 'taxonomy-v1';
  if topic_id is null then
    raise exception 'platform billing issue was not seeded';
  end if;

  insert into grm_review_topic_assignments (
    workspace_id, intelligence_id, review_id, topic_id, relevance, sentiment, polarity, excerpt
  ) values (
    ws_a, intel_a, review_a, topic_id, 0.900, 'negative', 'complaint', 'Billing queue'
  );

  begin
    insert into grm_review_topic_assignments (
      workspace_id, intelligence_id, review_id, topic_id, relevance, sentiment, polarity, excerpt
    ) values (
      ws_a, intel_a, review_a, topic_id, 0.100, 'negative', 'complaint', 'not in the review'
    );
    raise exception 'excerpt outside the review was stored';
  exception when others then
    if sqlerrm not like '%Excerpt is not contained%' then
      raise;
    end if;
  end;

  insert into grm_scope_summaries (
    workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, timezone,
    analysis_version, taxonomy_version, membership_hash, source_hash, status
  ) values (
    ws_a, client_a, 'organisation', client_a, 'Org A', 'all', 'Asia/Kolkata',
    'analysis-v1', 'taxonomy-v1', repeat('a', 32), 'src-1', 'ready'
  ) returning id into summary_all;

  insert into grm_scope_summaries (
    workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, range_start, range_end,
    range_label, timezone, analysis_version, taxonomy_version, membership_hash, source_hash, status
  ) values (
    ws_a, client_a, 'organisation', client_a, 'Org A', 'bounded',
    '2025-10-20T00:00:00Z', '2026-10-20T00:00:00Z', 'Last 12 months', 'Asia/Kolkata',
    'analysis-v1', 'taxonomy-v1', repeat('a', 32), 'src-1', 'ready'
  ) returning id into summary_year;

  if summary_all = summary_year then
    raise exception 'all-time and 12-month summaries collided';
  end if;

  begin
    insert into grm_scope_summaries (
      workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, timezone,
      analysis_version, taxonomy_version, membership_hash, source_hash, status
    ) values (
      ws_a, client_a, 'organisation', client_a, 'Org A', 'all', 'Asia/Kolkata',
      'analysis-v1', 'taxonomy-v1', repeat('a', 32), 'src-1', 'ready'
    );
    raise exception 'second all-time summary was inserted';
  exception when unique_violation then
    null;
  end;

  begin
    insert into grm_scope_summaries (
      workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, range_start, timezone,
      analysis_version, taxonomy_version, membership_hash
    ) values (
      ws_a, client_a, 'organisation', client_a, 'Org A', 'all', '1970-01-01T00:00:00Z', 'Asia/Kolkata',
      'analysis-v1', 'taxonomy-v1', repeat('b', 32)
    );
    raise exception 'all-time summary accepted a start date';
  exception when check_violation then
    null;
  end;

  insert into grm_scope_summaries (
    workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, timezone,
    analysis_version, taxonomy_version, membership_hash, member_location_ids, status
  ) values (
    ws_a, client_a, 'group', group_a, 'Region', 'all', 'Asia/Kolkata',
    'analysis-v1', 'taxonomy-v1', repeat('c', 32), array[loc_a], 'ready'
  ) returning id into summary_group;

  insert into grm_scope_summaries (
    workspace_id, client_id, scope_type, scope_id, scope_label, range_kind, timezone,
    analysis_version, taxonomy_version, membership_hash, member_location_ids, status
  ) values (
    ws_a, client_a, 'location', loc_a, 'Outlet', 'all', 'Asia/Kolkata',
    'analysis-v1', 'taxonomy-v1', repeat('d', 32), array[loc_a], 'ready'
  ) returning id into summary_loc;

  if summary_group = summary_loc then
    raise exception 'group and location summaries collided';
  end if;

  insert into grm_insight_reports (workspace_id, summary_id, prompt_version, model, status, findings)
  values (ws_a, summary_loc, 'prompt-v1', 'rules', 'ready', '[]'::jsonb)
  returning id into report_row;

  insert into grm_insight_evidence (workspace_id, report_id, finding_key, review_id, excerpt)
  values (ws_a, report_row, 'billing', review_a, 'Billing queue');

  delete from grm_reviews where id = review_a;
  if not exists (
    select 1 from grm_insight_evidence e
    where e.report_id = report_row and e.review_id is null and e.excerpt = 'Billing queue' and e.review_removed_at is not null
  ) then
    raise exception 'deleting a review dropped the evidence excerpt';
  end if;
  if not exists (select 1 from grm_insight_reports where id = report_row and status = 'stale') then
    raise exception 'deleting a review left the report ready';
  end if;

  delete from grm_groups where id = group_a;
  if not exists (
    select 1 from grm_scope_summaries where id = summary_group and scope_retired_at is not null and status = 'stale'
  ) then
    raise exception 'deleting a group removed or left its summary current';
  end if;

  insert into grm_review_embeddings (workspace_id, review_id, content_hash, model, embedding)
  values (
    ws_b, review_b, 'hash-b-001', 'gemini-embedding-001',
    (select array_fill(0::float8, array[768])::extensions.vector(768))
  );

  execute 'grant usage on schema public, extensions, auth to grm_rls';
  execute 'grant select on all tables in schema public to grm_rls';
  execute 'grant execute on all functions in schema public, auth to grm_rls';

  set local role grm_rls;
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  select count(*) into seen from grm_review_intelligence;
  if seen <> 0 then
    -- review A was deleted, so user A should see no intelligence rows, and never user B's
    raise exception 'user A saw % intelligence rows after their review was deleted', seen;
  end if;
  select count(*) into seen from grm_review_embeddings;
  if seen <> 0 then
    raise exception 'user A saw another workspace embedding';
  end if;
  select count(*) into seen from grm_scope_summaries where scope_type = 'organisation';
  if seen <> 2 then
    raise exception 'org admin should see all-time and 12-month organisation summaries, saw %', seen;
  end if;
  select count(*) into seen from grm_scope_summaries where workspace_id = ws_b;
  if seen <> 0 then
    raise exception 'user A saw workspace B summaries';
  end if;

  perform set_config('request.jwt.claim.sub', user_store::text, true);
  select count(*) into seen from grm_scope_summaries where scope_type = 'organisation';
  if seen <> 0 then
    raise exception 'store manager saw the organisation summary';
  end if;
  select count(*) into seen from grm_scope_summaries where scope_type = 'location';
  if seen <> 1 then
    raise exception 'store manager should see their location summary, saw %', seen;
  end if;
  select count(*) into seen from grm_scope_summaries where scope_type = 'group';
  if seen <> 0 then
    raise exception 'store manager saw the group summary';
  end if;

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  select count(*) into seen from grm_scope_summaries where workspace_id = ws_a;
  if seen <> 0 then
    raise exception 'workspace B saw workspace A summaries';
  end if;
  select count(*) into seen from grm_review_embeddings;
  if seen <> 1 then
    raise exception 'workspace B should see its own embedding, saw %', seen;
  end if;
  reset role;
end $$;

do $$
declare
  line text;
  plan text := '';
begin
  perform set_config('enable_seqscan', 'off', true);
  for line in
    explain (format text)
    select id
    from grm_scope_summaries
    where workspace_id = '11111111-1111-4111-8111-111111111111'
      and scope_type = 'organisation'
      and scope_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
      and range_kind = 'bounded'
      and range_start = '2025-10-20 00:00:00+00'
      and range_end = '2026-10-20 00:00:00+00'
  loop
    plan := plan || line || E'\n';
  end loop;
  if plan not like '%grm_scope_summaries_identity%' and plan not like '%grm_idx_scope_summaries_lookup%' then
    raise exception 'organisation window lookup did not use a summary index: %', plan;
  end if;

  plan := '';
  for line in
    explain (format text)
    select a.topic_id
    from grm_review_topic_assignments a
    where a.workspace_id = '22222222-2222-4222-8222-222222222222'
      and a.topic_id = (
        select id from grm_topics
        where workspace_id is null and code = 'billing' and kind = 'issue'
        limit 1
      )
  loop
    plan := plan || line || E'\n';
  end loop;
  if plan not like '%grm_idx_topic_assignments_topic%' and plan not like '%Index%' and plan not like '%Bitmap%' then
    raise exception 'topic lookup did not use an index: %', plan;
  end if;
end $$;
