-- Monthly Gemini spend ledger per workspace and operation.
-- Written by lib/services/ai-usage-ledger.ts after each provider call.
-- Reverse: drop policy grm_ai_usage_monthly_select; drop table public.grm_ai_usage_monthly;

create table if not exists public.grm_ai_usage_monthly (
  workspace_id  uuid        not null references public.grm_workspaces(id) on delete cascade,
  month         text        not null check (month ~ '^\d{4}-\d{2}$'),
  operation     text        not null check (operation in ('extract_review', 'extract_batch', 'embed_review', 'insight_prose', 'reply_draft', 'insight_brief')),
  calls         integer     not null default 0 check (calls >= 0),
  input_tokens  bigint      not null default 0 check (input_tokens >= 0),
  output_tokens bigint      not null default 0 check (output_tokens >= 0),
  estimated_usd numeric(12, 6) not null default 0 check (estimated_usd >= 0),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, month, operation)
);

comment on table public.grm_ai_usage_monthly is
  'Estimated Gemini spend by month. Costs are computed from usageMetadata at published prices, not a provider invoice. The service role writes; members may read their workspace rows.';

alter table public.grm_ai_usage_monthly enable row level security;

drop policy if exists grm_ai_usage_monthly_select on public.grm_ai_usage_monthly;
create policy grm_ai_usage_monthly_select
  on public.grm_ai_usage_monthly for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
