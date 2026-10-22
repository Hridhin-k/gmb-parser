-- Per-person notices for the profiles they cover.
-- Writes go through the service role. Members can read only their own rows.
-- Reverse: drop table public.grm_notifications;

create table if not exists public.grm_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  user_id uuid not null,
  location_id uuid references public.grm_google_locations(id) on delete cascade,
  kind text not null,
  title text not null,
  href text not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint grm_notifications_kind_check check (
    kind in ('new_reviews', 'escalation_assigned', 'sla_reminder', 'publish_failed')
  )
);

create unique index if not exists grm_notifications_dedupe
  on public.grm_notifications (workspace_id, user_id, dedupe_key);

create index if not exists grm_notifications_unread
  on public.grm_notifications (workspace_id, user_id, created_at desc)
  where read_at is null;

alter table public.grm_notifications enable row level security;

drop policy if exists "grm: members read their own notifications" on public.grm_notifications;
create policy "grm: members read their own notifications"
  on public.grm_notifications
  for select
  using (
    user_id = auth.uid()
    and workspace_id in (select public.grm_my_workspace_ids())
  );
