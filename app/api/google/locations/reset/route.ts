import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { AuditService } from "@/lib/services/audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { bustCatalogCache } from "@/lib/services/catalog-tables";

/**
 * POST /api/google/locations/reset
 * Moves all locations back into the Unassigned pool.
 */
export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const membership = await ensurePersonalWorkspace(user);

  try {
    const reset = await GoogleBusinessProfileService.resetAllLocationsToUnassigned(
      membership.workspace_id
    );

    await AuditService.log({
      workspaceId: membership.workspace_id,
      userId: user.id,
      action: "locations.reset_unassigned",
      entityType: "grm_google_locations",
      metadata: { reset } as Record<string, unknown>,
    });

    bustCatalogCache();
    return NextResponse.json({ success: true, reset });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    logger.error("locations.reset.failed", { userId: user.id });
    return NextResponse.json({ error: "Failed to reset locations" }, { status: 500 });
  }
}
