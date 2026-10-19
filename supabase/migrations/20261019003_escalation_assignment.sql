-- One owner decision per open case, separate from the configured location manager.
-- A location still has one group. Reviews stay on the review row.
-- sla_advanced_at is set the first time an overdue case moves one level, so a retry cannot move it again.

alter table public.grm_escalations
  add column if not exists responsible_user_id uuid references auth.users(id) on delete set null,
  add column if not exists ownership text not null default 'fallback',
  add column if not exists assignment_reason text,
  add column if not exists assignment_decided_at timestamptz,
  add column if not exists sla_advanced_at timestamptz;

do $$
begin
  alter table public.grm_escalations
    add constraint grm_escalations_ownership_check
    check (ownership in ('manager', 'fallback'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'grm_escalations_one_open_review')
     and not exists (
       select 1
       from public.grm_escalations
       where status <> 'resolved'
       group by workspace_id, review_id
       having count(*) > 1
     ) then
    create unique index grm_escalations_one_open_review
      on public.grm_escalations (workspace_id, review_id)
      where status <> 'resolved';
  end if;
end $$;
