-- Allow per-finding deep-dive calls in the AI usage ledger.
-- Reverse: restore the previous check without 'insight_deep_dive'.

alter table public.grm_ai_usage_monthly
  drop constraint if exists grm_ai_usage_monthly_operation_check;

alter table public.grm_ai_usage_monthly
  add constraint grm_ai_usage_monthly_operation_check
  check (operation in ('extract_review', 'extract_batch', 'embed_review', 'insight_prose', 'reply_draft', 'insight_brief', 'insight_deep_dive'));
