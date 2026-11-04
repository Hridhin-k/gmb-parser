-- Analysis status polling can also resume runs independently of sync jobs.
-- Close that second resume path for old jobs which have no selected period.
UPDATE public.grm_analysis_runs a SET status='failed',error_code='PERIOD_REQUIRED',
 error='Choose a sync period to continue. Completed review analysis is saved.',finished_at=now(),updated_at=now()
WHERE a.status='running' AND EXISTS(
 SELECT 1 FROM public.grm_location_pipeline_jobs j
 WHERE j.workspace_id=a.workspace_id AND j.analysis_run_id=a.id
   AND j.status='paused' AND j.error_code='PERIOD_REQUIRED'
);
