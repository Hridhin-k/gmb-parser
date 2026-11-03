import { getPool } from "@/lib/db/pool";

export interface InsightNote {
  id: string;
  /** YYYY-MM */
  month: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}

export interface NoteScope {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  locationIds: string[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isNoteMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

export function cleanNoteBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\s+/g, " ").trim();
  return body.length >= 1 && body.length <= 280 ? body : null;
}

type NoteRow = {
  id: string;
  month: string;
  body: string;
  created_by: string | null;
  created_at: string;
  client_id: string | null;
  group_id: string | null;
  location_id: string | null;
};

function toNote(row: NoteRow): InsightNote {
  return {
    id: row.id,
    month: String(row.month).slice(0, 7),
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
    clientId: row.client_id,
    groupId: row.group_id,
    locationId: row.location_id,
  };
}

/**
 * Notes for a scope between two months (inclusive): notes written for exactly
 * this place, plus notes on any location inside it.
 */
export async function listInsightNotes(
  workspaceId: string,
  scope: NoteScope,
  fromMonth: string,
  toMonth: string
): Promise<InsightNote[]> {
  if (scope.locationIds.length === 0) return [];
  const { rows } = await getPool().query<NoteRow>(
    `SELECT id, to_char(month, 'YYYY-MM') AS month, body, created_by, created_at, client_id, group_id, location_id
       FROM public.grm_insight_notes
      WHERE workspace_id = $1
        AND month >= $2::date AND month <= $3::date
        AND (
          location_id = ANY($4::uuid[])
          OR (location_id IS NULL
              AND client_id IS NOT DISTINCT FROM $5::uuid
              AND group_id IS NOT DISTINCT FROM $6::uuid
              AND $7::uuid IS NULL)
        )
      ORDER BY month, created_at
      LIMIT 200`,
    [workspaceId, `${fromMonth}-01`, `${toMonth}-01`, scope.locationIds, scope.clientId, scope.groupId, scope.locationId]
  );
  return rows.map(toNote);
}

export async function createInsightNote(
  workspaceId: string,
  userId: string,
  input: { clientId: string | null; groupId: string | null; locationId: string | null; month: string; body: string }
): Promise<InsightNote> {
  const { rows } = await getPool().query<NoteRow>(
    `INSERT INTO public.grm_insight_notes (workspace_id, client_id, group_id, location_id, month, body, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7)
     RETURNING id, to_char(month, 'YYYY-MM') AS month, body, created_by, created_at, client_id, group_id, location_id`,
    [workspaceId, input.clientId, input.groupId, input.locationId, `${input.month}-01`, input.body, userId]
  );
  return toNote(rows[0]);
}

export async function getInsightNote(workspaceId: string, id: string): Promise<InsightNote | null> {
  const { rows } = await getPool().query<NoteRow>(
    `SELECT id, to_char(month, 'YYYY-MM') AS month, body, created_by, created_at, client_id, group_id, location_id
       FROM public.grm_insight_notes WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id]
  );
  return rows[0] ? toNote(rows[0]) : null;
}

export async function deleteInsightNote(workspaceId: string, id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`DELETE FROM public.grm_insight_notes WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    id,
  ]);
  return (rowCount ?? 0) > 0;
}
