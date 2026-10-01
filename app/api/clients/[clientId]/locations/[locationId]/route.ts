import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { AuditService } from "@/lib/services/audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { validateId } from "@/lib/validation";

interface RouteParams {
  params: Promise<{ clientId: string; locationId: string }>;
}

/**
 * PUT /api/clients/[clientId]/locations/[locationId]
 * Connect a Google location to this client.
 */
export async function PUT(_request: Request, { params }: RouteParams) {
  const { clientId: rawClientId, locationId: rawLocationId } = await params;

  let clientId: string;
  let locationId: string;
  try {
    clientId = validateId(rawClientId, "clientId");
    locationId = validateId(rawLocationId, "locationId");
  } catch {
    return NextResponse.json({ error: "Invalid client or location ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
    await GoogleBusinessProfileService.connectLocationToClient(
      locationId,
      clientId,
      membership.workspace_id
    );

    await AuditService.log({
      workspaceId: membership.workspace_id,
      userId: user.id,
      action: "location.connected",
      entityType: "grm_google_locations",
      entityId: locationId,
      metadata: { clientId } as Record<string, unknown>,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    logger.error("location.connect.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      locationId,
      clientId,
    });
    return NextResponse.json({ error: "Failed to connect location" }, { status: 500 });
  }
}

/**
 * DELETE /api/clients/[clientId]/locations/[locationId]
 * Disconnect a location from this client (does not delete Google data).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { clientId: rawClientId, locationId: rawLocationId } = await params;

  let locationId: string;
  try {
    validateId(rawClientId, "clientId");
    locationId = validateId(rawLocationId, "locationId");
  } catch {
    return NextResponse.json({ error: "Invalid client or location ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
    await GoogleBusinessProfileService.disconnectLocation(locationId, membership.workspace_id);

    await AuditService.log({
      workspaceId: membership.workspace_id,
      userId: user.id,
      action: "location.disconnected",
      entityType: "grm_google_locations",
      entityId: locationId,
    });

    return NextResponse.json({ success: true });
  } catch {
    logger.error("location.disconnect.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      locationId,
    });
    return NextResponse.json({ error: "Failed to disconnect location" }, { status: 500 });
  }
}
