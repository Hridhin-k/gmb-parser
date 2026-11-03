-- Notes an owner pins to a month on the Insights mood timeline ("new menu",
-- "two hygienists left"), so later they can see what a change did to the mood.
-- A note belongs to the place it was written for: the whole workspace, a
-- business, a group, or one location.
CREATE TABLE public.grm_insight_notes (
 id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 client_id uuid,
 group_id uuid,
 location_id uuid,
 month date NOT NULL,
 body text NOT NULL,
 created_by uuid REFERENCES authn.users(id) ON DELETE SET NULL,
 created_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT grm_insight_notes_month_check CHECK (month = date_trunc('month', month)::date),
 CONSTRAINT grm_insight_notes_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 280)
);
CREATE UNIQUE INDEX tenant_key_grm_insight_notes ON public.grm_insight_notes (workspace_id, id);
ALTER TABLE public.grm_insight_notes ADD CONSTRAINT grm_insight_notes_client_fk FOREIGN KEY (workspace_id, client_id) REFERENCES public.grm_clients (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.grm_insight_notes ADD CONSTRAINT grm_insight_notes_group_fk FOREIGN KEY (workspace_id, group_id) REFERENCES public.grm_groups (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.grm_insight_notes ADD CONSTRAINT grm_insight_notes_location_fk FOREIGN KEY (workspace_id, location_id) REFERENCES public.grm_google_locations (workspace_id, id) ON DELETE CASCADE;
CREATE INDEX grm_insight_notes_workspace_month ON public.grm_insight_notes (workspace_id, month);
CREATE INDEX grm_insight_notes_location ON public.grm_insight_notes (workspace_id, location_id) WHERE location_id IS NOT NULL;
CREATE TRIGGER trg_grm_insight_notes_updated_at BEFORE UPDATE ON public.grm_insight_notes FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();
