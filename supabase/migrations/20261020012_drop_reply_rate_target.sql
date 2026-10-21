-- The reply-rate target is no longer part of the product.

alter table public.grm_escalation_policies
  drop constraint if exists grm_escalation_policies_reply_target_check;

alter table public.grm_escalation_policies
  drop column if exists reply_rate_target;
