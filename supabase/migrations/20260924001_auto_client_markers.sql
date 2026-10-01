-- Idempotent auto-client markers: one client per Google location per workspace.
-- Prevents duplicate clients under concurrent Sync requests.
create unique index if not exists grm_clients_auto_loc_marker_uidx
  on public.grm_clients (workspace_id, notes)
  where notes like 'grm:auto:loc:%';

-- At most one active Unassigned holding client per workspace.
create unique index if not exists grm_clients_unassigned_active_uidx
  on public.grm_clients (workspace_id)
  where notes = 'grm:system:unassigned' and is_active = true;
