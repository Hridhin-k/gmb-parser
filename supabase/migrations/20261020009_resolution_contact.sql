-- Organisation phone and email a person can insert into an escalation reply.
-- Nothing inserts these values automatically.

alter table public.grm_escalation_policies
  add column if not exists resolution_phone text,
  add column if not exists resolution_email text;

alter table public.grm_escalation_policies
  drop constraint if exists grm_escalation_policies_resolution_phone_check;

alter table public.grm_escalation_policies
  add constraint grm_escalation_policies_resolution_phone_check
  check (resolution_phone is null or char_length(resolution_phone) between 6 and 40);

alter table public.grm_escalation_policies
  drop constraint if exists grm_escalation_policies_resolution_email_check;

alter table public.grm_escalation_policies
  add constraint grm_escalation_policies_resolution_email_check
  check (resolution_email is null or char_length(resolution_email) between 3 and 320);

comment on column public.grm_escalation_policies.resolution_phone is
  'Organisation phone a person can insert into an escalation reply. Nothing inserts it automatically.';

comment on column public.grm_escalation_policies.resolution_email is
  'Organisation email a person can insert into an escalation reply. Nothing inserts it automatically.';
