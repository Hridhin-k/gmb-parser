import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { AppError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const disconnectSchema = z.object({ connectionId: z.string().uuid("Invalid connectionId") });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let connectionId: string;
  try {
    const body = await parseBody(request, disconnectSchema);
    connectionId = body.connectionId;
  } catch {
    return NextResponse.json({ error: "connectionId is required and must be a valid UUID" }, { status: 400 });
  }

  // Verify user belongs to the workspace that owns this connection
  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("grm_google_connections")
    .select("workspace_id")
    .eq("id", connectionId)
    .single();

  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", connection.workspace_id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    await GoogleOAuthService.revokeConnection(
      connectionId,
      connection.workspace_id,
      user.id
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof AppError ? err.message : "Failed to disconnect";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
