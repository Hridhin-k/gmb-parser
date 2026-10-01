import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { AuditService } from "@/lib/services/audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * POST /api/google/locations/reset
 * Moves all locations back into the Unassigned pool.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

    return NextResponse.json({ success: true, reset });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    logger.error("locations.reset.failed", { userId: user.id });
    return NextResponse.json({ error: "Failed to reset locations" }, { status: 500 });
  }
}
