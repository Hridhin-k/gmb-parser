-- A separate marker version avoids re-keying historical rows or merging owners.
-- Concurrent discovery can create only one active business per exact identity.
CREATE UNIQUE INDEX IF NOT EXISTS grm_clients_auto_org_v2_uidx
  ON public.grm_clients (workspace_id, notes)
  WHERE is_active AND notes LIKE 'grm:auto:org:v2:%';
