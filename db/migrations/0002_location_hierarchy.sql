-- Complete the location fields previously assumed to exist in the shared DB.
ALTER TABLE public.grm_google_locations
 ADD COLUMN brand_id uuid REFERENCES public.grm_brands(id) ON DELETE SET NULL,
 ADD COLUMN manager_user_id uuid REFERENCES authn.users(id) ON DELETE SET NULL,
 ADD COLUMN onboarding_group_id uuid REFERENCES public.grm_location_groups(id) ON DELETE SET NULL;
-- Onboarding's temporary import buckets and the editable region/city hierarchy
-- are distinct concepts; a location cannot share one FK between both tables.
ALTER TABLE public.grm_google_locations DROP CONSTRAINT grm_google_locations_group_id_fkey;
ALTER TABLE public.grm_google_locations ADD CONSTRAINT grm_google_locations_group_id_fkey FOREIGN KEY(group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;
ALTER TABLE public.grm_scope_settings DROP CONSTRAINT grm_scope_settings_group_id_fkey;
ALTER TABLE public.grm_scope_settings ADD CONSTRAINT grm_scope_settings_group_id_fkey FOREIGN KEY(group_id) REFERENCES public.grm_groups(id) ON DELETE CASCADE;
ALTER TABLE public.grm_reports DROP CONSTRAINT grm_reports_group_id_fkey;
ALTER TABLE public.grm_reports ADD CONSTRAINT grm_reports_group_id_fkey FOREIGN KEY(group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;
ALTER TABLE public.grm_report_schedules DROP CONSTRAINT grm_report_schedules_group_id_fkey;
ALTER TABLE public.grm_report_schedules ADD CONSTRAINT grm_report_schedules_group_id_fkey FOREIGN KEY(group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;
ALTER TABLE public.grm_alert_rules DROP CONSTRAINT grm_alert_rules_group_id_fkey;
ALTER TABLE public.grm_alert_rules ADD CONSTRAINT grm_alert_rules_group_id_fkey FOREIGN KEY(group_id) REFERENCES public.grm_groups(id) ON DELETE SET NULL;
CREATE INDEX grm_locations_onboarding_group ON public.grm_google_locations(workspace_id,onboarding_group_id);
CREATE UNIQUE INDEX grm_escalations_trigger ON public.grm_escalations(workspace_id,review_id,trigger_key);
