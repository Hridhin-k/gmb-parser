ALTER TABLE public.grm_location_pipeline_jobs
 ADD COLUMN range_key text,
 ADD COLUMN range_label text,
 ADD COLUMN range_start timestamptz,
 ADD COLUMN range_end timestamptz,
 ADD COLUMN error_code text;
ALTER TABLE public.grm_location_pipeline_jobs DROP CONSTRAINT grm_location_pipeline_jobs_status_check;
ALTER TABLE public.grm_location_pipeline_jobs ADD CONSTRAINT grm_location_pipeline_jobs_status_check
 CHECK(status IN ('queued','running','paused','completed','partial','failed'));
ALTER TABLE public.grm_location_pipeline_jobs ADD CONSTRAINT grm_pipeline_range_order
 CHECK(range_start IS NULL OR range_end IS NULL OR range_start<range_end);
ALTER TABLE public.grm_analysis_runs ADD COLUMN error_code text;

-- Old jobs were not period-bound. Keep their checkpoints and completed work,
-- but require an explicit period before doing any more all-history analysis.
UPDATE public.grm_location_pipeline_jobs SET status='paused',error_code='PERIOD_REQUIRED',
 error='Choose a sync period to continue. Reviews and completed analysis are saved.',
 lease_token=NULL,lease_until=NULL,updated_at=now()
 WHERE status IN ('queued','running') AND range_key IS NULL;

CREATE TABLE public.grm_pipeline_ai_blocks (
 workspace_id uuid PRIMARY KEY REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 error_code text NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grm_pipeline_recent_scope ON public.grm_location_pipeline_jobs(workspace_id,location_id,range_key,created_at DESC);
