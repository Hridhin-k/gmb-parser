-- Empty comparison periods also have dependencies: a new review there must
-- invalidate a report even though no daily source existed at generation time.
CREATE OR REPLACE FUNCTION public.grm_dirty_insight_day(p_workspace uuid,p_location uuid,p_time timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE zone text; local_day date;
BEGIN
 zone := public.grm_review_timezone(p_workspace,p_location);
 IF zone IS NULL THEN RETURN; END IF;
 local_day := (p_time AT TIME ZONE zone)::date;
 INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
 VALUES(p_workspace,p_location,local_day,zone)
 ON CONFLICT(workspace_id,location_id,day,timezone)
 DO UPDATE SET revision=grm_insight_days.revision+1;
 UPDATE public.grm_insight_reports r SET stale_at=now()
 WHERE r.workspace_id=p_workspace AND r.stale_at IS NULL
   AND r.location_ids ? p_location::text
   AND ((r.range_start IS NULL OR p_time>=r.range_start) AND (r.range_end IS NULL OR p_time<r.range_end)
     OR (r.evidence_summary->>'comparisonStart') IS NOT NULL
       AND p_time>=(r.evidence_summary->>'comparisonStart')::timestamptz
       AND ((r.evidence_summary->>'comparisonEnd') IS NULL OR p_time<(r.evidence_summary->>'comparisonEnd')::timestamptz)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.evidence_summary->'dailySources','[]'::jsonb)) s
       WHERE s->>'locationId'=p_location::text AND s->>'day'=local_day::text));
END
$$;

CREATE OR REPLACE FUNCTION public.grm_insight_timezone_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_workspace uuid; changed_location uuid;
BEGIN
 changed_workspace := COALESCE(NEW.workspace_id,OLD.workspace_id);
 IF TG_TABLE_NAME='grm_google_locations' THEN
   IF OLD.review_timezone IS NOT DISTINCT FROM NEW.review_timezone THEN RETURN NEW; END IF;
   changed_location := NEW.id;
 ELSIF TG_OP='UPDATE' AND OLD.timezone IS NOT DISTINCT FROM NEW.timezone THEN RETURN NEW;
 END IF;
 INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
 SELECT DISTINCT r.workspace_id,r.location_id,(r.review_create_time AT TIME ZONE z.zone)::date,z.zone
 FROM public.grm_reviews r CROSS JOIN LATERAL (SELECT public.grm_review_timezone(r.workspace_id,r.location_id) zone) z
 WHERE r.workspace_id=changed_workspace AND (changed_location IS NULL OR r.location_id=changed_location)
 ON CONFLICT(workspace_id,location_id,day,timezone) DO UPDATE SET revision=grm_insight_days.revision+1;
 UPDATE public.grm_insight_reports SET stale_at=now() WHERE workspace_id=changed_workspace AND stale_at IS NULL
   AND (changed_location IS NULL OR location_ids ? changed_location::text);
 RETURN COALESCE(NEW,OLD);
END
$$;
CREATE TRIGGER grm_workspace_timezone_removed AFTER DELETE ON public.grm_escalation_policies
 FOR EACH ROW EXECUTE FUNCTION public.grm_insight_timezone_changed();
