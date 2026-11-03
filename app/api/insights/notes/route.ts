import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertScoped } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import {
  cleanNoteBody,
  createInsightNote,
  deleteInsightNote,
  getInsightNote,
  isNoteMonth,
} from "@/lib/services/insight-notes";
import { validateId } from "@/lib/validation";
import { AuthorizationError, toStatusCode, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";

async function actor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const membership = await ensurePersonalWorkspace(user);
  return { user, workspaceId: membership.workspace_id as string };
}

/** The place a note belongs to, for the scoped permission check. */
function noteTarget(place: { clientId: string | null; groupId: string | null; locationId: string | null }) {
  if (place.locationId) return { kind: "location" as const, id: place.locationId };
  if (place.groupId) return { kind: "group" as const, id: place.groupId };
  if (place.clientId) return { kind: "client" as const, id: place.clientId };
  return { kind: "workspace" as const };
}

function denied(error: unknown) {
  return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
}

/**
 * POST /api/insights/notes
 *
 * Pins a note to a month on the mood timeline for the caller's resolved
 * scope. The scope is re-resolved on the server from the posted params, so a
 * note can only be written for a place the member can see, and only by a
 * role that may draft there. Read-only roles cannot write notes.
 */
export async function POST(request: Request) {
  const current = await actor();
  if (!current) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const text = cleanNoteBody(body.body);
  if (!text) return NextResponse.json({ error: "Write a note of up to 280 characters." }, { status: 400 });
  if (!isNoteMonth(body.month)) return NextResponse.json({ error: "Pick a month for the note." }, { status: 400 });

  const scope = await readPageScope(current.user.id, current.workspaceId, {
    client: typeof body.client === "string" ? body.client : undefined,
    group: typeof body.group === "string" ? body.group : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
  });
  // A place that was asked for but is not available must not fall back to another one.
  if (scope.dropped) return NextResponse.json({ error: "That place is not available to you." }, { status: 403 });
  if (scope.blocked || scope.locationIds.length === 0) {
    return NextResponse.json({ error: "No locations in the selected place." }, { status: 400 });
  }
  try {
    await assertScoped({ userId: current.user.id, workspaceId: current.workspaceId, permission: "draft", target: noteTarget(scope) });
  } catch (error) {
    return denied(error);
  }

  try {
    const note = await createInsightNote(current.workspaceId, current.user.id, {
      clientId: scope.clientId,
      groupId: scope.groupId,
      locationId: scope.locationId,
      month: body.month,
      body: text,
    });
    return NextResponse.json({ note });
  } catch (error) {
    logger.error("insight_note.create_failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not save the note. Please try again." }, { status: 500 });
  }
}

/**
 * DELETE /api/insights/notes?id=
 *
 * The person who wrote a note, or someone who may edit rules for its place,
 * can remove it.
 */
export async function DELETE(request: Request) {
  const current = await actor();
  if (!current) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let id: string;
  try {
    id = validateId(new URL(request.url).searchParams.get("id"), "id");
  } catch {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }
  const note = await getInsightNote(current.workspaceId, id);
  if (!note) return NextResponse.json({ error: "That note is not in this workspace." }, { status: 404 });
  if (note.createdBy !== current.user.id) {
    try {
      await assertScoped({ userId: current.user.id, workspaceId: current.workspaceId, permission: "edit_rules", target: noteTarget(note) });
    } catch (error) {
      return denied(
        error instanceof AuthorizationError
          ? new AuthorizationError("Only the person who wrote this note or a manager can remove it.")
          : error
      );
    }
  }
  try {
    await deleteInsightNote(current.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("insight_note.delete_failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not remove the note. Please try again." }, { status: 500 });
  }
}
