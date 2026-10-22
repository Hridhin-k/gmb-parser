-- Insights removal: the Insights section and its intelligence pipeline are
-- being rebuilt from scratch. This drops every insight/intelligence table.
-- Review, reply, escalation, and AI-usage data are untouched.
--
-- Reverse: re-apply the migrations that created these tables
-- (20260924002, 20261019001, 20261019004 (feedback only), 20261020002,
-- 20261020005, 20261020013). Stored insight content cannot be recovered.

-- Insight knowledge rows and the lens kind go away with the feature.
delete from public.grm_ai_knowledge where kind = 'insight_lens';

alter table public.grm_ai_knowledge
  drop constraint if exists grm_ai_knowledge_kind_check;

alter table public.grm_ai_knowledge
  add constraint grm_ai_knowledge_kind_check
  check (kind in ('instruction', 'faq', 'response_rule', 'approved_example'));

comment on table public.grm_ai_knowledge is
  'Structured tenant knowledge: instructions, FAQs, response rules, and approved examples.';

-- Generation jobs now only carry reply drafts.
delete from public.grm_ai_generation_jobs where kind in ('location_insight', 'scope_insight');

alter table public.grm_ai_generation_jobs
  drop constraint if exists grm_ai_generation_jobs_kind_check;

alter table public.grm_ai_generation_jobs
  add constraint grm_ai_generation_jobs_kind_check
  check (kind in ('reply'));

-- Insight and intelligence tables. Children first; cascade clears the rest.
drop table if exists public.grm_insight_evidence cascade;
drop table if exists public.grm_insight_reports cascade;
drop table if exists public.grm_cluster_events cascade;
drop table if exists public.grm_cluster_members cascade;
drop table if exists public.grm_semantic_clusters cascade;
drop table if exists public.grm_review_embeddings cascade;
drop table if exists public.grm_review_topic_assignments cascade;
drop table if exists public.grm_topic_aliases cascade;
drop table if exists public.grm_topics cascade;
drop table if exists public.grm_review_intelligence cascade;
drop table if exists public.grm_intelligence_jobs cascade;
drop table if exists public.grm_metric_snapshots cascade;
drop table if exists public.grm_metric_definitions cascade;
drop table if exists public.grm_scope_summaries cascade;
drop table if exists public.grm_org_summaries cascade;
drop table if exists public.grm_insight_feedback cascade;
drop table if exists public.grm_location_insights cascade;
drop table if exists public.grm_scope_insights cascade;

-- Triggers on tables that stay (they point at the functions dropped below).
drop trigger if exists trg_grm_note_removed_review_evidence on public.grm_reviews;
drop trigger if exists trg_grm_retire_client_summaries on public.grm_clients;
drop trigger if exists trg_grm_retire_group_summaries on public.grm_groups;
drop trigger if exists trg_grm_retire_location_summaries on public.grm_google_locations;

-- Guard and helper functions that only served those tables.
drop function if exists public.grm_guard_review_intelligence() cascade;
drop function if exists public.grm_review_intelligence_single_current() cascade;
drop function if exists public.grm_guard_topic_alias() cascade;
drop function if exists public.grm_guard_topic_assignment() cascade;
drop function if exists public.grm_guard_review_embedding() cascade;
drop function if exists public.grm_guard_cluster_member() cascade;
drop function if exists public.grm_guard_scope_summary() cascade;
drop function if exists public.grm_guard_insight_report() cascade;
drop function if exists public.grm_guard_insight_evidence() cascade;
drop function if exists public.grm_guard_metric_snapshot() cascade;
drop function if exists public.grm_guard_intelligence_job() cascade;
drop function if exists public.grm_note_removed_review_evidence() cascade;
drop function if exists public.grm_retire_scope_summaries() cascade;
drop function if exists public.grm_stale_report_on_summary_change() cascade;
drop function if exists public.grm_can_see_scope_summary(uuid, text, uuid, uuid, uuid, uuid) cascade;
