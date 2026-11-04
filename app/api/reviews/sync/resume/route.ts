import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace, assertCanSyncWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { drainLocationPipelines, resumeLocationPipelines } from "@/lib/services/location-pipeline";
import { parseBody } from "@/lib/validation";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { checkRateLimit, SYNC_ALL_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const maxDuration = 300;
const schema = z.object({ jobIds: z.array(z.uuid()).min(1).max(1000) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, schema);
    const { workspace_id: workspaceId } = await ensurePersonalWorkspace(user);
    await assertCanSyncWorkspace(user.id, workspaceId);
    if (!checkRateLimit(user.id, "sync.resume", SYNC_ALL_LIMIT).allowed) return NextResponse.json({ error: "Please wait before resuming again." }, { status: 429 });
    const scope = await readPageScope(user.id, workspaceId, {});
    await resumeLocationPipelines(workspaceId, body.jobIds, scope.locationIds);
    after(async () => {
      try { await drainLocationPipelines({ workspaceId, jobIds: body.jobIds, limit: 2 }); }
      catch (error) { logger.error("pipeline.resume_failed", { workspaceId, message: String(error) }); }
    });
    return NextResponse.json({ jobIds: body.jobIds, status: "queued" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
