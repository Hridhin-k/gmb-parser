-- Independent metadata refresh: no analysis or summary job is enqueued.
CREATE TABLE public.grm_review_edit_sync (
  location_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
  last_completed_at timestamptz,
  run_started_at timestamptz,
  cutoff timestamptz,
  page_token text,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  pages_processed integer NOT NULL DEFAULT 0,
  reviews_checked integer NOT NULL DEFAULT 0,
  reviews_updated integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT grm_review_edit_sync_location_fk FOREIGN KEY (workspace_id,location_id)
    REFERENCES public.grm_google_locations(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX grm_review_edit_sync_due ON public.grm_review_edit_sync(available_at,last_attempt_at);
