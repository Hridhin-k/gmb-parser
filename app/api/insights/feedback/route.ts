import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { saveInsightFeedback } from "@/lib/services/ai-config";

const bodySchema = z.object({
  insightKind: z.enum(["location", "scope", "page"]),
  scopeId: z.string().uuid(),
  rating: z.enum(["useful", "not_useful"]),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  const admin = createAdminClient();
  try {
    let workspaceId: string;
    let clientIdForAccess: string | null = null;

    if (body.insightKind === "location") {
      const { data: location } = await admin
        .from("grm_google_locations")
        .select("id, workspace_id, client_id")
        .eq("id", body.scopeId)
        .maybeSingle();
      if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
      workspaceId = location.workspace_id;
      clientIdForAccess = location.client_id;
    } else if (body.insightKind === "scope") {
      const { data: client } = await admin
        .from("grm_clients")
        .select("id, workspace_id")
        .eq("id", body.scopeId)
        .maybeSingle();
      if (client) {
        workspaceId = client.workspace_id;
        clientIdForAccess = client.id;
      } else {
        const { data: group } = await admin
          .from("grm_groups")
          .select("id, workspace_id, client_id")
          .eq("id", body.scopeId)
          .maybeSingle();
        if (!group) return NextResponse.json({ error: "Scope not found" }, { status: 404 });
        workspaceId = group.workspace_id;
        clientIdForAccess = group.client_id;
      }
    } else {
      const { data: membership } = await admin
        .from("grm_workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .eq("workspace_id", body.scopeId)
        .maybeSingle();
      if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      workspaceId = membership.workspace_id;
    }

    const { data: membership } = await admin
      .from("grm_workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const access = await getMemberAccess(user.id, workspaceId);
    const allowed = await visibleClientIds(workspaceId, access?.scope);
    if (allowed && clientIdForAccess && !allowed.includes(clientIdForAccess)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await saveInsightFeedback({
      workspaceId,
      userId: user.id,
      insightKind: body.insightKind,
      scopeId: body.scopeId,
      rating: body.rating,
      note: body.note,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  }
}
