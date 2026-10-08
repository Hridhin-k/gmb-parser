import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewSyncService } from "@/lib/services/review-sync";
import { AppError, GoogleApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody, syncBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode } from "@/lib/errors";
import { checkRateLimit, SYNC_LOCATION_LIMIT, SYNC_ALL_LIMIT } from "@/lib/rate-limit";
import { assertCanSyncWorkspace, ensurePersonalWorkspace } from "@/lib/services/workspace";

/**
 * POST /api/reviews/sync
 *
 * Body (one of):
 *   { all: true }                                    — sync all connected locations
 *   { all: false; locationId: string; connectionId: string } — sync one location
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { all?: boolean; locationId?: string; connectionId?: string; full?: boolean };
  try {
    body = await parseBody(request, syncBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user);

  const { workspace_id: workspaceId } = membership;

  try {
    await assertCanSyncWorkspace(user.id, workspaceId);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  // ── Sync all locations ────────────────────────────────────────────────────
  if (body.all) {
    const rl = checkRateLimit(user.id, "sync.all", SYNC_ALL_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many sync requests. Please wait before syncing again." },
        { status: 429 }
      );
    }

    try {
      const result = await ReviewSyncService.syncAllWorkspaceLocations(workspaceId, user.id, {
        mode: body.full ? "full" : "incremental",
      });
      return NextResponse.json({ success: true, ...result });
    } catch {
      logger.error("sync.all.failed", { userId: user.id, workspaceId });
      return NextResponse.json({ error: "Failed to sync reviews" }, { status: 500 });
    }
  }

  // ── Sync a single location ────────────────────────────────────────────────
  const { locationId, connectionId } = body as { locationId: string; connectionId: string };

  const rl = checkRateLimit(user.id, "sync.location", SYNC_LOCATION_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many sync requests. Please wait before syncing again." },
      { status: 429 }
    );
  }

  // Verify location belongs to the workspace
  const { data: locationRow } = await admin
    .from("grm_google_locations")
    .select("id")
    .eq("id", locationId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!locationRow) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  // Verify connection belongs to the workspace
  const { data: connectionRow } = await admin
    .from("grm_google_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!connectionRow) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    const result = await ReviewSyncService.syncLocation(
      locationId,
      connectionId,
      workspaceId,
      user.id,
      { mode: body.full ? "full" : "incremental" }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "OAUTH_REVOKED" || error.code === "OAUTH_INVALID_GRANT") {
        return NextResponse.json(
          { error: "Your Google authorization has been revoked. Please reconnect your account." },
          { status: 401 }
        );
      }
    }

    if (error instanceof GoogleApiError) {
      if (error.googleErrorCode === 403) {
        return NextResponse.json(
          { error: "Insufficient permission to read reviews for this location." },
          { status: 403 }
        );
      }
      if (error.googleErrorCode === 429) {
        return NextResponse.json(
          { error: "Google API quota exceeded. Please try again later." },
          { status: 429 }
        );
      }
    }

    logger.error("sync.location.failed", {
      userId: user.id,
      workspaceId,
      locationId,
      connectionId,
    });
    return NextResponse.json({ error: "Failed to sync reviews. Please try again." }, { status: 500 });
  }
}
