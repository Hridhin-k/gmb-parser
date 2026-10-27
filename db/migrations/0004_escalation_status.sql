ALTER TABLE public.grm_escalations DROP CONSTRAINT grm_escalations_status_check;
ALTER TABLE public.grm_escalations ALTER COLUMN status SET DEFAULT 'needs_human';
ALTER TABLE public.grm_escalations ADD CONSTRAINT grm_escalations_status_check CHECK(status IN ('needs_human','in_progress','resolved'));
