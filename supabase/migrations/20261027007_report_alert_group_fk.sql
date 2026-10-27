-- Report schedules and alert rules still attach group_id to
-- grm_location_groups (added in 20261016006). The app stores regions and
-- cities in grm_groups and writes those ids from reporting.ts. Locations
-- were retargeted in 20261027001; these two child tables were not.
--
-- Align only when every non-null group_id already exists in grm_groups.
-- Column type, nullability, and ON DELETE SET NULL are unchanged. No data
-- rewrite. Idempotent when the FK already points at grm_groups.
--
-- Do not apply this to production until it has been reviewed. Rollback:
-- drop the new constraints and recreate
--   foreign key (group_id) references public.grm_location_groups(id)
--   on delete set null
-- only if this migration changed them.

do $$
declare
  v_name text;
  v_target regclass;
begin
  select c.conname, c.confrelid::regclass
    into v_name, v_target
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.grm_report_schedules'::regclass
    and c.contype = 'f'
    and a.attname = 'group_id'
  limit 1;

  if v_name is null or v_target = 'public.grm_groups'::regclass then
    return;
  end if;

  if exists (
    select 1
    from public.grm_report_schedules s
    where s.group_id is not null
      and not exists (select 1 from public.grm_groups g where g.id = s.group_id)
  ) then
    raise exception
      'grm_report_schedules.group_id has values that are not in grm_groups. Refusing to retarget the foreign key.';
  end if;

  execute format('alter table public.grm_report_schedules drop constraint %I', v_name);
  alter table public.grm_report_schedules
    add constraint grm_report_schedules_group_id_fkey
    foreign key (group_id) references public.grm_groups(id) on delete set null;
end $$;

do $$
declare
  v_name text;
  v_target regclass;
begin
  select c.conname, c.confrelid::regclass
    into v_name, v_target
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.grm_alert_rules'::regclass
    and c.contype = 'f'
    and a.attname = 'group_id'
  limit 1;

  if v_name is null or v_target = 'public.grm_groups'::regclass then
    return;
  end if;

  if exists (
    select 1
    from public.grm_alert_rules r
    where r.group_id is not null
      and not exists (select 1 from public.grm_groups g where g.id = r.group_id)
  ) then
    raise exception
      'grm_alert_rules.group_id has values that are not in grm_groups. Refusing to retarget the foreign key.';
  end if;

  execute format('alter table public.grm_alert_rules drop constraint %I', v_name);
  alter table public.grm_alert_rules
    add constraint grm_alert_rules_group_id_fkey
    foreign key (group_id) references public.grm_groups(id) on delete set null;
end $$;
