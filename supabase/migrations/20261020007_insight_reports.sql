-- Version insight reports by their input hash.
-- Reverse: drop index public.grm_insight_reports_version;
-- drop index public.grm_intelligence_jobs_open_report;
-- alter table public.grm_insight_reports drop column if exists source_hash, drop column if exists report_version, drop column if exists input_key;
-- The previous unique (summary_id, prompt_version) is replaced so a new input keeps the older report.

alter table public.grm_insight_reports drop constraint if exists grm_insight_reports_summary_id_prompt_version_key;

alter table public.grm_insight_reports
  add column if not exists source_hash text not null default '',
  add column if not exists report_version integer not null default 1 check (report_version >= 1),
  add column if not exists input_key text not null default '';

create unique index if not exists grm_insight_reports_version
  on public.grm_insight_reports (summary_id, prompt_version, source_hash, report_version);

create unique index if not exists grm_intelligence_jobs_open_report
  on public.grm_intelligence_jobs (workspace_id, operation, source_hash)
  where status in ('queued', 'running')
    and operation = 'build_report';

comment on table public.grm_insight_reports is
  'One row per summary, prompt, source hash, and version. A newer input adds a row. A stale row is not a current report.';
