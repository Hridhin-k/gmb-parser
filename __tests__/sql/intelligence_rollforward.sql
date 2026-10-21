-- Applied after 20261020003 through 20261020007 on the throwaway database.
-- Confirms the later migrations leave a versioned report history.

do $$
declare
  ws uuid := '11111111-1111-4111-8111-111111111111';
  sid uuid;
  seen int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grm_reviews' and column_name = 'content_fingerprint'
  ) then
    raise exception 'content_fingerprint missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grm_review_intelligence' and column_name = 'extraction'
  ) then
    raise exception 'extraction missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grm_scope_summaries' and column_name = 'document'
  ) then
    raise exception 'summary document missing';
  end if;

  select id into sid from grm_scope_summaries where workspace_id = ws limit 1;
  if sid is null then
    raise exception 'phase 1 check did not leave a summary';
  end if;

  insert into grm_insight_reports (
    workspace_id, summary_id, prompt_version, model, status, findings, source_hash, report_version
  ) values
    (ws, sid, 'insight-v1', 'none', 'ready', '[]'::jsonb, 'hash-old', 1),
    (ws, sid, 'insight-v1', 'none', 'stale', '[]'::jsonb, 'hash-old', 2);

  select count(*) into seen from grm_insight_reports
  where summary_id = sid and prompt_version = 'insight-v1' and source_hash = 'hash-old';
  if seen <> 2 then
    raise exception 'report history was collapsed, saw %', seen;
  end if;

  begin
    insert into grm_insight_reports (
      workspace_id, summary_id, prompt_version, model, status, findings, source_hash, report_version
    ) values (
      ws, sid, 'insight-v1', 'none', 'ready', '[]'::jsonb, 'hash-old', 2
    );
    raise exception 'duplicate report version was inserted';
  exception when unique_violation then
    null;
  end;
end $$;
