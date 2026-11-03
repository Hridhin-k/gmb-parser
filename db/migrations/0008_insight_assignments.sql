-- Who is looking after a suggested action on Insights ("What to do next").
-- An action is identified by the saved AI insight it came from.
CREATE TABLE public.grm_insight_assignments (
 workspace_id uuid NOT NULL REFERENCES public.grm_workspaces(id) ON DELETE CASCADE,
 action_id text NOT NULL,
 title text NOT NULL,
 assignee_id uuid NOT NULL REFERENCES authn.users(id) ON DELETE CASCADE,
 assigned_by uuid REFERENCES authn.users(id) ON DELETE SET NULL,
 created_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 PRIMARY KEY (workspace_id, action_id),
 CONSTRAINT grm_insight_assignments_action_check CHECK (action_id ~ '^[a-f0-9]{24}(-[0-9]{1,3})?$'),
 CONSTRAINT grm_insight_assignments_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 400)
);
CREATE TRIGGER trg_grm_insight_assignments_updated_at BEFORE UPDATE ON public.grm_insight_assignments FOR EACH ROW EXECUTE FUNCTION public.grm_set_updated_at();
