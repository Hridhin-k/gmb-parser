import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/db/client";
import { ReviewSyncService } from "@/lib/services/review-sync";
import { AppError, GoogleApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody, syncBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode } from "@/lib/errors";
import { checkRateLimit, SYNC_LOCATION_LIMIT, SYNC_ALL_LIMIT } from "@/lib/rate-limit";
import { assertCanSyncWorkspace, ensurePersonalWorkspace } from "@/lib/services/workspace";
import { withGooglePriority } from "@/lib/google-api-gate";
import { describeSyncFailure } from "@/lib/sync-failure";

export const maxDuration = 60;

/**
 * POST /api/reviews/sync
 *
 * Body (one of):
 *   { all: true }                                    — sync all connected locations
 *   { all: false; locationId: string; connectionId: string } — sync one location
 */
export function POST(request: Request) {
  // A person is waiting: this sync jumps ahead of cron/background Google calls.
  return withGooglePriority("interactive", () => handleSync(request));
}

function failureResponse(errorClass: string | null | undefined, extra: Record<string, unknown> = {}) {
  const info = describeSyncFailure(errorClass);
  return NextResponse.json(
    {
      error: info.message,
      code: errorClass ?? "unknown",
      retryable: info.retryable,
      retryAfterSeconds: info.retryAfterSeconds,
      action: info.action,
      ...extra,
    },
    {
      status: info.status,
      headers: info.retryAfterSeconds ? { "Retry-After": String(info.retryAfterSeconds) } : undefined,
    }
  );
}

async function handleSync(request: Request) {
  const user = await getCurrentUser();

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

      const failures = result.results.filter((r) => r.errorClass && r.reviewsSynced === 0);
      const classes = [...new Set(failures.map((r) => r.errorClass as string))];
      // Everything failed for the same reason: say that reason, with a real status.
      if (result.locationsAttempted > 0 && result.locationsSucceeded === 0 && classes.length === 1) {
        return failureResponse(classes[0], { locationsFailed: result.locationsFailed });
      }
      // Some failed: report success for what worked and say what to do about the rest.
      const worst = classes[0];
      return NextResponse.json({
        success: true,
        partial: failures.length > 0,
        warning: worst ? describeSyncFailure(worst).message : undefined,
        retryable: failures.length > 0 && classes.every((c) => describeSyncFailure(c).retryable),
        retryAfterSeconds: worst ? describeSyncFailure(worst).retryAfterSeconds : undefined,
        ...result,
      });
    } catch (error) {
      logger.error("sync.all.failed", {
        userId: user.id,
        workspaceId,
        message: error instanceof Error ? error.message : "Unknown",
      });
      return failureResponse(error instanceof GoogleApiError && error.googleErrorCode === 429 ? "rate_limit" : "unknown");
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

    // syncLocation records provider failures on the result instead of throwing.
    if (result.errorClass && result.reviewsSynced === 0) {
      return failureResponse(result.errorClass);
    }
    if (result.errorClass) {
      // Some pages were stored before Google failed: keep them, flag the rest.
      return NextResponse.json({
        success: true,
        partial: true,
        warning: describeSyncFailure(result.errorClass).message,
        retryable: describeSyncFailure(result.errorClass).retryable,
        retryAfterSeconds: describeSyncFailure(result.errorClass).retryAfterSeconds,
        ...result,
      });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "OAUTH_REVOKED" || error.code === "OAUTH_INVALID_GRANT") {
        return failureResponse("authentication");
      }
    }

    if (error instanceof GoogleApiError) {
      if (error.googleErrorCode === 403) return failureResponse("authorization");
      if (error.googleErrorCode === 429) return failureResponse("rate_limit");
    }

    logger.error("sync.location.failed", {
      userId: user.id,
      workspaceId,
      locationId,
      connectionId,
    });
    return failureResponse("unknown");
  }
}
