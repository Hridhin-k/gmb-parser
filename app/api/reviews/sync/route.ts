import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { parseBody, syncBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode } from "@/lib/errors";
import { checkRateLimit, SYNC_LOCATION_LIMIT, SYNC_ALL_LIMIT } from "@/lib/rate-limit";
import { assertCanSyncWorkspace, ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { drainLocationPipelines, enqueueLocationPipelines } from "@/lib/services/location-pipeline";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

/** Persist an explicit scope before acknowledging the click. The connection
 * comes from each location's account; posted connection IDs are never used. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, syncBodySchema);
    const { workspace_id: workspaceId } = await ensurePersonalWorkspace(user);
    await assertCanSyncWorkspace(user.id, workspaceId);
    const limit = checkRateLimit(user.id, body.all ? "sync.all" : "sync.location", body.all ? SYNC_ALL_LIMIT : SYNC_LOCATION_LIMIT);
    if (!limit.allowed) return NextResponse.json({ error: "Please wait before syncing again." }, { status: 429 });
    const scope = await readPageScope(user.id, workspaceId, {});
    const wanted = body.all ? body.locationIds ?? scope.locationIds : [body.locationId];
    const allowed = new Set(scope.locationIds);
    if (wanted.length === 0) return NextResponse.json({ error: "Select a location to sync." }, { status: 400 });
    if (wanted.some((id) => !allowed.has(id))) return NextResponse.json({ error: "A selected location is outside your access." }, { status: 403 });
    const jobIds = await enqueueLocationPipelines(workspaceId, user.id, wanted, body.full);
    after(async () => {
      try { await drainLocationPipelines({ workspaceId, jobIds, limit: 2 }); }
      catch (error) { logger.error("pipeline.start_failed", { workspaceId, message: String(error) }); }
    });
    return NextResponse.json({ jobIds, status: "queued", locationIds: [...new Set(wanted)] }, { status: 202 });
  } catch (error) {
    logger.error("pipeline.enqueue_failed", { message: String(error) });
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
