-- A durable, location-scoped queue. A browser request only enqueues work;
-- workers claim leases and the scheduler resumes interrupted jobs.
CREATE TABLE public.grm_location_pipeline_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 location_id uuid NOT NULL,
 requested_by uuid REFERENCES authn.users(id) ON DELETE SET NULL,
 sync_mode text NOT NULL DEFAULT 'incremental' CHECK (sync_mode IN ('incremental','full')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','partial','failed')),
 phase text NOT NULL DEFAULT 'fetching' CHECK (phase IN ('fetching','analysing','summarising','done')),
 sync_result jsonb,
 sync_checkpoint jsonb,
 analysis_run_id uuid REFERENCES public.grm_analysis_runs(id) ON DELETE SET NULL,
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 FOREIGN KEY (workspace_id,location_id) REFERENCES public.grm_google_locations(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX grm_location_pipeline_active ON public.grm_location_pipeline_jobs(workspace_id,location_id)
 WHERE status IN ('queued','running');
CREATE INDEX grm_location_pipeline_due ON public.grm_location_pipeline_jobs(available_at,lease_until)
 WHERE status IN ('queued','running');

-- Until a location has its own zone, inherit the workspace's existing policy.
ALTER TABLE public.grm_google_locations ADD COLUMN review_timezone text;
ALTER TABLE public.grm_insight_reports ADD COLUMN stale_at timestamptz;

CREATE FUNCTION public.grm_review_timezone(p_workspace uuid,p_location uuid) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT COALESCE(
   (SELECT name FROM pg_timezone_names WHERE name=l.review_timezone),
   (SELECT name FROM pg_timezone_names WHERE name=p.timezone), 'Asia/Kolkata')
 FROM public.grm_google_locations l
 LEFT JOIN public.grm_escalation_policies p ON p.workspace_id=l.workspace_id
 WHERE l.workspace_id=p_workspace AND l.id=p_location
$$;

-- Revisions are never deleted: an edit during a summary rebuild remains dirty.
CREATE TABLE public.grm_insight_days (
 workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 location_id uuid NOT NULL,
 day date NOT NULL,
 timezone text NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,location_id,day,timezone),
 FOREIGN KEY(workspace_id,location_id) REFERENCES public.grm_google_locations(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE public.grm_daily_insights (
 workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 location_id uuid NOT NULL,
 day date NOT NULL,
 timezone text NOT NULL,
 analysis_version text NOT NULL,
 summary_version integer NOT NULL,
 source_revision bigint NOT NULL,
 summary jsonb NOT NULL,
 built_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,location_id,day,timezone,analysis_version),
 FOREIGN KEY(workspace_id,location_id) REFERENCES public.grm_google_locations(workspace_id,id) ON DELETE CASCADE
);

CREATE FUNCTION public.grm_dirty_insight_day(p_workspace uuid,p_location uuid,p_time timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE zone text; local_day date;
BEGIN
 zone := public.grm_review_timezone(p_workspace,p_location);
 IF zone IS NULL THEN RETURN; END IF; -- Parent is being cascade-deleted.
 local_day := (p_time AT TIME ZONE zone)::date;
 INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
 VALUES(p_workspace,p_location,local_day,zone)
 ON CONFLICT(workspace_id,location_id,day,timezone)
 DO UPDATE SET revision=grm_insight_days.revision+1;
 UPDATE public.grm_insight_reports r SET stale_at=now()
 WHERE r.workspace_id=p_workspace AND r.stale_at IS NULL
   AND r.location_ids ? p_location::text
   AND ((r.range_start IS NULL OR p_time>=r.range_start) AND (r.range_end IS NULL OR p_time<r.range_end)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.evidence_summary->'dailySources','[]'::jsonb)) s
       WHERE s->>'locationId'=p_location::text AND s->>'day'=local_day::text));
END
$$;

CREATE FUNCTION public.grm_review_insight_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.comment,OLD.star_rating,OLD.review_create_time,OLD.location_id,OLD.missing_on_google_at,OLD.content_fingerprint)
   IS NOT DISTINCT FROM (NEW.comment,NEW.star_rating,NEW.review_create_time,NEW.location_id,NEW.missing_on_google_at,NEW.content_fingerprint)
 THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN
   PERFORM public.grm_dirty_insight_day(OLD.workspace_id,OLD.location_id,OLD.review_create_time);
 END IF;
 IF TG_OP<>'DELETE' THEN
   PERFORM public.grm_dirty_insight_day(NEW.workspace_id,NEW.location_id,NEW.review_create_time);
 END IF;
 IF TG_OP='UPDATE' THEN
   UPDATE public.grm_review_analyses SET status='stale'
   WHERE workspace_id=NEW.workspace_id AND review_id=NEW.id AND status IN ('ready','no_text');
 END IF;
 RETURN COALESCE(NEW,OLD);
END
$$;
CREATE TRIGGER grm_review_insight_changed AFTER INSERT OR UPDATE OR DELETE ON public.grm_reviews
 FOR EACH ROW EXECUTE FUNCTION public.grm_review_insight_changed();

CREATE FUNCTION public.grm_analysis_insight_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.status,OLD.content_fingerprint,OLD.processed_at,OLD.analysis_version)
   IS NOT DISTINCT FROM (NEW.status,NEW.content_fingerprint,NEW.processed_at,NEW.analysis_version)
 THEN RETURN NEW; END IF;
 SELECT workspace_id,location_id,review_create_time INTO r FROM public.grm_reviews
 WHERE workspace_id=COALESCE(NEW.workspace_id,OLD.workspace_id) AND id=COALESCE(NEW.review_id,OLD.review_id);
 IF FOUND THEN PERFORM public.grm_dirty_insight_day(r.workspace_id,r.location_id,r.review_create_time); END IF;
 RETURN COALESCE(NEW,OLD);
END
$$;
CREATE TRIGGER grm_analysis_insight_changed AFTER INSERT OR UPDATE OR DELETE ON public.grm_review_analyses
 FOR EACH ROW EXECUTE FUNCTION public.grm_analysis_insight_changed();

-- Existing history gets summaries lazily, without repeating successful AI analysis.
-- Resolve timezone catalog lookups once per location, not once per review.
WITH zones AS MATERIALIZED (
 SELECT l.workspace_id,l.id location_id,public.grm_review_timezone(l.workspace_id,l.id) zone
 FROM public.grm_google_locations l
)
INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
SELECT DISTINCT r.workspace_id,r.location_id,(r.review_create_time AT TIME ZONE z.zone)::date,z.zone
FROM public.grm_reviews r
JOIN zones z ON z.workspace_id=r.workspace_id AND z.location_id=r.location_id;

CREATE FUNCTION public.grm_insight_timezone_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE location record;
BEGIN
 IF TG_TABLE_NAME='grm_google_locations' THEN
   IF OLD.review_timezone IS NOT DISTINCT FROM NEW.review_timezone THEN RETURN NEW; END IF;
   FOR location IN SELECT NEW.workspace_id workspace_id,NEW.id id LOOP
     INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
     SELECT DISTINCT r.workspace_id,r.location_id,(r.review_create_time AT TIME ZONE z.zone)::date,z.zone
     FROM public.grm_reviews r CROSS JOIN LATERAL (SELECT public.grm_review_timezone(r.workspace_id,r.location_id) zone) z
     WHERE r.workspace_id=location.workspace_id AND r.location_id=location.id
     ON CONFLICT(workspace_id,location_id,day,timezone) DO UPDATE SET revision=grm_insight_days.revision+1;
   END LOOP;
 ELSE
   IF TG_OP='UPDATE' AND OLD.timezone IS NOT DISTINCT FROM NEW.timezone THEN RETURN NEW; END IF;
   INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
   SELECT DISTINCT r.workspace_id,r.location_id,(r.review_create_time AT TIME ZONE z.zone)::date,z.zone
   FROM public.grm_reviews r CROSS JOIN LATERAL (SELECT public.grm_review_timezone(r.workspace_id,r.location_id) zone) z
   WHERE r.workspace_id=NEW.workspace_id
   ON CONFLICT(workspace_id,location_id,day,timezone) DO UPDATE SET revision=grm_insight_days.revision+1;
 END IF;
 UPDATE public.grm_insight_reports SET stale_at=now() WHERE workspace_id=NEW.workspace_id AND stale_at IS NULL;
 RETURN NEW;
END
$$;
CREATE TRIGGER grm_location_timezone_changed AFTER UPDATE OF review_timezone ON public.grm_google_locations
 FOR EACH ROW EXECUTE FUNCTION public.grm_insight_timezone_changed();
CREATE TRIGGER grm_workspace_timezone_changed AFTER INSERT OR UPDATE OF timezone ON public.grm_escalation_policies
 FOR EACH ROW EXECUTE FUNCTION public.grm_insight_timezone_changed();
