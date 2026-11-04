-- Reject new unbounded work, including requests from an older app container
-- during a rolling deployment. Historical paused/completed rows are retained.
ALTER TABLE public.grm_location_pipeline_jobs ADD CONSTRAINT grm_pipeline_active_period
 CHECK(status NOT IN ('queued','running') OR (range_key IS NOT NULL AND range_end IS NOT NULL));
