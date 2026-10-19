import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationInsightService } from "@/lib/services/location-insights";
import { ScopeInsightService } from "@/lib/services/scope-insights";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/validation";
import { checkRateLimit, AI_GENERATE_LIMIT } from "@/lib/rate-limit";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";

const bodySchema = z
  .object({
    locationId: z.string().uuid().optional(),
    scopeKind: z.enum(["client", "group"]).optional(),
    scopeId: z.string().uuid().optional(),
    force: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasLocation = Boolean(value.locationId);
    const hasScope = Boolean(value.scopeKind && value.scopeId);
    if (hasLocation === hasScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either locationId or scopeKind+scopeId",
      });
    }
  });

/**
 * POST /api/insights/generate
 * Body: { locationId, force? } OR { scopeKind: "client"|"group", scopeId, force? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "insights.generate", {
    ...AI_GENERATE_LIMIT,
    limit: 8,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Insight generation rate limit reached. Wait a minute to conserve AI quota.",
      },
      { status: 429 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    if (body.locationId) {
      const { data: location } = await admin
        .from("grm_google_locations")
        .select("id, workspace_id, client_id")
        .eq("id", body.locationId)
        .single();

      if (!location) {
        return NextResponse.json({ error: "Location not found" }, { status: 404 });
      }

      const { data: membership } = await admin
        .from("grm_workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .eq("workspace_id", location.workspace_id)
        .single();

      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const access = await getMemberAccess(user.id, location.workspace_id);
      const allowed = await visibleClientIds(location.workspace_id, access?.scope);
      if (allowed && location.client_id && !allowed.includes(location.client_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const insight = await LocationInsightService.generateForLocation(
        location.workspace_id,
        body.locationId,
        user.id,
        { force: body.force === true }
      );
      return NextResponse.json({ success: true, insight });
    }

    const scopeKind = body.scopeKind!;
    const scopeId = body.scopeId!;

    let workspaceId: string;
    let clientIdForAccess: string | null = null;

    if (scopeKind === "client") {
      const { data: client } = await admin
        .from("grm_clients")
        .select("id, workspace_id")
        .eq("id", scopeId)
        .maybeSingle();
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      workspaceId = client.workspace_id;
      clientIdForAccess = client.id;
    } else {
      const { data: group } = await admin
        .from("grm_groups")
        .select("id, workspace_id, client_id")
        .eq("id", scopeId)
        .maybeSingle();
      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      workspaceId = group.workspace_id;
      clientIdForAccess = group.client_id;
    }

    const { data: membership } = await admin
      .from("grm_workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const access = await getMemberAccess(user.id, workspaceId);
    const allowed = await visibleClientIds(workspaceId, access?.scope);
    if (allowed && clientIdForAccess && !allowed.includes(clientIdForAccess)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const insight = await ScopeInsightService.generate(
      workspaceId,
      scopeKind,
      scopeId,
      user.id,
      { force: body.force === true }
    );
    return NextResponse.json({ success: true, insight });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode >= 400 ? error.statusCode : 500 }
      );
    }
    logger.error("insights.generate.failed", {
      userId: user.id,
      locationId: body.locationId ?? undefined,
      scopeKind: body.scopeKind ?? undefined,
      scopeId: body.scopeId ?? undefined,
    });
    return NextResponse.json(
      { error: "Failed to generate insight" },
      { status: 500 }
    );
  }
}
