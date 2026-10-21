-- A stable per-organisation number so each escalation can be opened as ESC-1, ESC-2, and so on.

alter table public.grm_escalations
  add column if not exists ticket_no integer;

with numbered as (
  select id, row_number() over (partition by workspace_id order by opened_at, id) as n
  from public.grm_escalations
  where ticket_no is null
)
update public.grm_escalations as escalation
set ticket_no = numbered.n
from numbered
where escalation.id = numbered.id;

alter table public.grm_escalations
  alter column ticket_no set not null;

create unique index if not exists grm_escalations_ticket_no
  on public.grm_escalations (workspace_id, ticket_no);

create or replace function public.grm_assign_escalation_ticket()
returns trigger
language plpgsql
as $$
declare
  assigned integer;
begin
  if new.ticket_no is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
  select coalesce(max(ticket_no), 0) + 1
    into assigned
  from public.grm_escalations
  where workspace_id = new.workspace_id;
  new.ticket_no := assigned;
  return new;
end;
$$;

drop trigger if exists grm_assign_escalation_ticket on public.grm_escalations;
create trigger grm_assign_escalation_ticket
  before insert on public.grm_escalations
  for each row
  execute function public.grm_assign_escalation_ticket();

comment on column public.grm_escalations.ticket_no is
  'Organisation-local case number. Shown as ESC-{ticket_no}.';
