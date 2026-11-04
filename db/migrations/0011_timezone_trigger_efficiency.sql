-- A first contact save inserts a policy using the existing fallback timezone.
-- It must not rebuild history unless the effective timezone actually changes.
CREATE OR REPLACE FUNCTION public.grm_insight_timezone_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_workspace uuid; changed_location uuid; previous_zone text; next_zone text;
BEGIN
 changed_workspace := COALESCE(NEW.workspace_id,OLD.workspace_id);
 IF TG_TABLE_NAME='grm_google_locations' THEN
   IF OLD.review_timezone IS NOT DISTINCT FROM NEW.review_timezone THEN RETURN NEW; END IF;
   changed_location := NEW.id;
 ELSE
   previous_zone := 'Asia/Kolkata';
   next_zone := 'Asia/Kolkata';
   IF TG_OP<>'INSERT' THEN
     SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name=OLD.timezone),'Asia/Kolkata') INTO previous_zone;
   END IF;
   IF TG_OP<>'DELETE' THEN
     SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name=NEW.timezone),'Asia/Kolkata') INTO next_zone;
   END IF;
   IF previous_zone=next_zone THEN RETURN COALESCE(NEW,OLD); END IF;
 END IF;
 -- Catalog lookups belong to locations, not individual reviews. Materializing
 -- prevents the planner from repeating them for every historical review.
 WITH zones AS MATERIALIZED (
   SELECT l.workspace_id,l.id location_id,public.grm_review_timezone(l.workspace_id,l.id) zone
   FROM public.grm_google_locations l
   WHERE l.workspace_id=changed_workspace AND (changed_location IS NULL OR l.id=changed_location)
 )
 INSERT INTO public.grm_insight_days(workspace_id,location_id,day,timezone)
 SELECT DISTINCT r.workspace_id,r.location_id,(r.review_create_time AT TIME ZONE z.zone)::date,z.zone
 FROM public.grm_reviews r JOIN zones z ON z.workspace_id=r.workspace_id AND z.location_id=r.location_id
 ON CONFLICT(workspace_id,location_id,day,timezone) DO UPDATE SET revision=grm_insight_days.revision+1;
 UPDATE public.grm_insight_reports SET stale_at=now() WHERE workspace_id=changed_workspace AND stale_at IS NULL
   AND (changed_location IS NULL OR location_ids ? changed_location::text);
 RETURN COALESCE(NEW,OLD);
END
$$;
