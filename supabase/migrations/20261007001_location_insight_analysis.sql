-- Richer per-profile AI briefing (branding, staff, feedback, suggested features).
alter table public.grm_location_insights
  add column if not exists analysis jsonb not null default '{}'::jsonb;

comment on column public.grm_location_insights.analysis is
  'Structured Gemini briefing: branding, staff, customer feedback, operations, suggested features, reply playbook.';
