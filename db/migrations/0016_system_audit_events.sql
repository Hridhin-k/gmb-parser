-- Scheduled AI/analysis work has no human actor. Preserve that distinction.
ALTER TABLE public.grm_audit_logs ALTER COLUMN user_id DROP NOT NULL;
COMMENT ON COLUMN public.grm_audit_logs.user_id IS 'Human actor when available; NULL for system/background operations.';
