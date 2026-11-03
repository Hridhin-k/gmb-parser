import { getPool } from "@/lib/db/pool";

export interface InsightAssignment {
  actionId: string;
  assigneeId: string;
}

const ACTION_ID = /^[a-f0-9]{24}(-\d{1,3})?$/;

/** Action ids are the ids of saved AI insights. */
export function isActionId(value: unknown): value is string {
  return typeof value === "string" && ACTION_ID.test(value);
}

export async function listInsightAssignments(workspaceId: string, actionIds: string[]): Promise<InsightAssignment[]> {
  const ids = actionIds.filter(isActionId);
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<{ action_id: string; assignee_id: string }>(
    `SELECT action_id, assignee_id FROM public.grm_insight_assignments
      WHERE workspace_id = $1 AND action_id = ANY($2::text[])`,
    [workspaceId, ids]
  );
  return rows.map((row) => ({ actionId: row.action_id, assigneeId: row.assignee_id }));
}

/** Assigns an action to one person, replacing whoever had it. */
export async function assignInsightAction(
  workspaceId: string,
  userId: string,
  input: { actionId: string; title: string; assigneeId: string }
): Promise<void> {
  await getPool().query(
    `INSERT INTO public.grm_insight_assignments (workspace_id, action_id, title, assignee_id, assigned_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, action_id)
     DO UPDATE SET title = excluded.title, assignee_id = excluded.assignee_id, assigned_by = excluded.assigned_by`,
    [workspaceId, input.actionId, input.title, input.assigneeId, userId]
  );
}

export async function unassignInsightAction(workspaceId: string, actionId: string): Promise<void> {
  await getPool().query(`DELETE FROM public.grm_insight_assignments WHERE workspace_id = $1 AND action_id = $2`, [
    workspaceId,
    actionId,
  ]);
}
