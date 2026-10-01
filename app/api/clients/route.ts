import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { AuditService } from "@/lib/services/audit";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/validation";

const createClientSchema = z.object({
  name: z.string().min(1, "Client name is required").max(200).transform((s) => s.trim()),
  notes: z.string().max(1000).optional().transform((s) => s?.trim()),
});

/**
 * POST /api/clients
 * Body: { name: string; notes?: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { name: string; notes?: string };
  try {
    body = await parseBody(request, createClientSchema);
  } catch {
    return NextResponse.json({ error: "Client name is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user);

  try {
    const client = await GoogleBusinessProfileService.createClient(
      membership.workspace_id,
      user.id,
      body.name,
      body.notes
    );

    await AuditService.log({
      workspaceId: membership.workspace_id,
      userId: user.id,
      action: "client.created",
      entityType: "grm_clients",
      entityId: client.id,
      metadata: { name: body.name } as Record<string, unknown>,
    });

    return NextResponse.json(client, { status: 201 });
  } catch {
    logger.error("client.create.failed", { userId: user.id, workspaceId: membership.workspace_id });
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
