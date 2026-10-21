-- Structured summary body. Reverse: drop index grm_intelligence_jobs_open_summary;
-- alter table public.grm_scope_summaries drop column if exists document, drop column if exists last_error;

alter table public.grm_scope_summaries
  add column if not exists document jsonb not null default '{}'::jsonb,
  add column if not exists last_error text;

comment on column public.grm_scope_summaries.document is
  'Structured summary-v1 counts, shares, evidence, and coverage. The summary text column is a sentence derived from this document.';

comment on column public.grm_scope_summaries.summary is
  'Short deterministic narrative derived from document. Not an LLM paragraph.';

create unique index if not exists grm_intelligence_jobs_open_summary
  on public.grm_intelligence_jobs (workspace_id, operation, source_hash)
  where status in ('queued', 'running')
    and operation = 'build_summary';
