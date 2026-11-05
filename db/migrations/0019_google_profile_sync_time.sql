-- Discovery cooldown belongs to each Google login, not its reviews/workspace.
ALTER TABLE public.grm_google_connections
  ADD COLUMN IF NOT EXISTS last_profile_sync_at timestamptz;
