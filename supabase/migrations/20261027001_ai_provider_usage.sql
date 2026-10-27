-- Provider-neutral attempt history and atomic monthly increments.
alter table public.grm_ai_usage_monthly drop constraint if exists grm_ai_usage_monthly_operation_check;
alter table public.grm_ai_usage_monthly add constraint grm_ai_usage_monthly_operation_check
  check (operation in ('extract_review', 'extract_batch', 'embed_review', 'insight_prose', 'reply_draft', 'insight_brief', 'insight_deep_dive', 'preview'));

create table public.grm_ai_call_events (
  id uuid primary key,
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  operation text not null,
  model text not null, -- provider:native-model-id
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  estimated_usd numeric(16,8) not null check (estimated_usd >= 0),
  usage_known boolean not null,
  status text not null,
  created_at timestamptz not null default now()
);
create index grm_ai_call_events_workspace_time on public.grm_ai_call_events (workspace_id, created_at desc);
alter table public.grm_ai_call_events enable row level security;
revoke all on public.grm_ai_call_events from anon, authenticated;
grant select, insert on public.grm_ai_call_events to service_role;
create policy grm_ai_call_events_service_read on public.grm_ai_call_events
  for select to service_role using (true);
create policy grm_ai_call_events_service_insert on public.grm_ai_call_events
  for insert to service_role with check (true);
grant select, insert, update on public.grm_ai_usage_monthly to service_role;

create function public.grm_record_ai_usage(
  p_event_id uuid, p_workspace_id uuid, p_month text, p_operation text,
  p_model text, p_input_tokens bigint, p_output_tokens bigint,
  p_estimated_usd numeric, p_usage_known boolean, p_status text, p_calls integer
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.grm_ai_call_events (id, workspace_id, operation, model, input_tokens, output_tokens, estimated_usd, usage_known, status)
  values (p_event_id, p_workspace_id, p_operation, p_model, p_input_tokens, p_output_tokens, p_estimated_usd, p_usage_known, p_status)
  on conflict (id) do nothing;
  if not found then return; end if;
  insert into public.grm_ai_usage_monthly (workspace_id, month, operation, calls, input_tokens, output_tokens, estimated_usd)
  values (p_workspace_id, p_month, p_operation, p_calls, p_input_tokens, p_output_tokens, p_estimated_usd)
  on conflict (workspace_id, month, operation) do update set
    calls = public.grm_ai_usage_monthly.calls + excluded.calls,
    input_tokens = public.grm_ai_usage_monthly.input_tokens + excluded.input_tokens,
    output_tokens = public.grm_ai_usage_monthly.output_tokens + excluded.output_tokens,
    estimated_usd = public.grm_ai_usage_monthly.estimated_usd + excluded.estimated_usd,
    updated_at = now();
end;
$$;
revoke all on function public.grm_record_ai_usage(uuid, uuid, text, text, text, bigint, bigint, numeric, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.grm_record_ai_usage(uuid, uuid, text, text, text, bigint, bigint, numeric, boolean, text, integer) to service_role;
