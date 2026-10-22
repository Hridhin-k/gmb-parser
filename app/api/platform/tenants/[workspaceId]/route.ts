import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";
import { actOnTenant, updateTenantSettings } from "@/lib/services/platform";

interface RouteParams { params: Promise<{ workspaceId: string }> }
const schema = z.object({ action: z.enum(["suspend", "reactivate", "delete", "restore"]) });

/** POST /api/platform/tenants/[workspaceId] — suspend / reactivate / soft-delete / restore a tenant. */
export async function POST(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { workspaceId: raw } = await params;
  let workspaceId: string;
  try { workspaceId = validateId(raw, "workspaceId"); } catch { return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 }); }
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await actOnTenant({ actor: user, workspaceId, action: body.action });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update that tenant." }, { status: 500 });
  }
}

const settingsSchema = z.object({
  plan: z.enum(["trial", "starter", "growth", "enterprise", "lifetime"]).optional(),
  planExpiresAt: z.string().datetime().nullable().optional(),
  aiBudgetUsd: z.number().min(0).max(100000).nullable().optional(),
  maxLocations: z.number().int().positive().max(100000).nullable().optional(),
  maxMembers: z.number().int().positive().max(100000).nullable().optional(),
  adminNote: z.string().max(2000).nullable().optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
});

/** PATCH /api/platform/tenants/[workspaceId] — plan, limits, note, feature flags. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { workspaceId: raw } = await params;
  let workspaceId: string;
  try { workspaceId = validateId(raw, "workspaceId"); } catch { return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 }); }
  let body: z.infer<typeof settingsSchema>;
  try { body = await parseBody(request, settingsSchema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await updateTenantSettings({ actor: user, workspaceId, ...body });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update that tenant." }, { status: 500 });
  }
}
