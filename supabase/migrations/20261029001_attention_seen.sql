-- Per-person "opened" marks for inbox, escalations, and bell items.
-- Opening a review or escalation drops that person's count even while the
-- work is still open. A bell summary stays hidden until its title changes.
-- Reverse: drop table public.grm_attention_seen;

create table if not exists public.grm_attention_seen (
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('review', 'escalation', 'alert')),
  entity_id text not null,
  fingerprint text,
  seen_at timestamptz not null default now(),
  primary key (workspace_id, user_id, kind, entity_id)
);

comment on table public.grm_attention_seen is
  'Items this person has opened. Inbox and escalation badges skip these. Alert rows hide a bell item while its title still matches fingerprint.';

alter table public.grm_attention_seen enable row level security;
