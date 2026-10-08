import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { AuditService } from "@/lib/services/audit";
import { AppError, GoogleApiError } from "@/lib/errors";
import { assertCanSyncWorkspace } from "@/lib/services/workspace";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/validation";
import { checkRateLimit, SYNC_ALL_LIMIT } from "@/lib/rate-limit";

const syncSchema = z.object({
  connectionId: z.string().uuid("Invalid connectionId"),
  force: z.boolean().optional(),
});

/**
 * POST /api/google/sync
 * Body: { connectionId: string, force?: boolean }
 *
 * Discovers Google Business Profile locations and auto-creates one client
 * per managed profile. Idempotent. Rate-limited to protect Google quota.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "google.sync_locations", SYNC_ALL_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Sync rate limit reached. Wait a few minutes before syncing again to conserve Google API quota.",
      },
      { status: 429 }
    );
  }

  let body: { connectionId: string; force?: boolean };
  try {
    body = await parseBody(request, syncSchema);
  } catch {
    return NextResponse.json(
      { error: "connectionId is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const { connectionId, force } = body;

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("grm_google_connections")
    .select("id, workspace_id, status")
    .eq("id", connectionId)
    .single();

  if (!connection || connection.status !== "active") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", connection.workspace_id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertCanSyncWorkspace(user.id, connection.workspace_id);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  try {
    const result = await GoogleBusinessProfileService.syncConnectionAccounts(
      connectionId,
      connection.workspace_id,
      { force: force === true, userId: user.id }
    );

    await AuditService.log({
      workspaceId: connection.workspace_id,
      userId: user.id,
      action: "google_sync.completed",
      entityType: "grm_google_connections",
      entityId: connectionId,
      metadata: result as Record<string, unknown>,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "GBP_INSUFFICIENT_PERMISSION") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === "OAUTH_REVOKED" || error.code === "OAUTH_INVALID_GRANT") {
        return NextResponse.json(
          {
            error:
              "Your Google authorization has been revoked. Please reconnect your Google account.",
          },
          { status: 401 }
        );
      }
    }

    if (error instanceof GoogleApiError) {
      if (error.googleErrorCode === 429) {
        return NextResponse.json(
          { error: "Google API quota exceeded. Please try again later." },
          { status: 429 }
        );
      }
    }

    logger.error("google.sync.failed", { userId: user.id, connectionId });
    return NextResponse.json(
      { error: "Failed to sync Google profiles. Please try again." },
      { status: 500 }
    );
  }
}
