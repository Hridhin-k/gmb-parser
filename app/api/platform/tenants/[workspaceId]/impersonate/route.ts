import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { validateId } from "@/lib/validation";
import { requireSuperAdmin } from "@/lib/services/platform";
import { AuditService } from "@/lib/services/audit";
import { SUPPORT_TENANT_COOKIE } from "@/lib/platform-admin";

interface RouteParams { params: Promise<{ workspaceId: string }> }

/** POST: enter read-only support view of a tenant. DELETE: exit it. */
export async function POST(_request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { workspaceId: raw } = await params;
  let workspaceId: string;
  try { workspaceId = validateId(raw, "workspaceId"); } catch { return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 }); }
  try {
    await requireSuperAdmin(user);
    const admin = createAdminClient();
    const { data: ws } = await admin.from("grm_workspaces").select("id, status").eq("id", workspaceId).maybeSingle();
    if (!ws || ws.status === "deleted") return NextResponse.json({ error: "That tenant cannot be viewed." }, { status: 404 });
    await AuditService.log({ workspaceId, userId: user.id, action: "platform.support_view_started", entityType: "grm_workspaces", entityId: workspaceId, metadata: { supportView: true } }).catch(() => undefined);
    const response = NextResponse.json({ success: true });
    response.cookies.set(SUPPORT_TENANT_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 4 });
    return response;
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not enter support view." }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SUPPORT_TENANT_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
