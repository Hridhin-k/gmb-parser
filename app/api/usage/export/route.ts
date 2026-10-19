import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, parseDateRange } from "@/lib/date-range";
import { csvRow } from "@/lib/services/review-export";
import { usageExportLines } from "@/lib/agency-portal";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { workspaceGrant } from "@/lib/access";
import { getMemberRole } from "@/lib/services/workspace";
import { checkRateLimit, EXPORT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/usage/export — CSV of location and review volume for invoicing. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "usage.export", EXPORT_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const membership = await ensurePersonalWorkspace(user);
  const role = await getMemberRole(user.id, membership.workspace_id);
  if (!workspaceGrant(role, "manage_people")) {
    return NextResponse.json({ error: "You cannot export usage." }, { status: 403 });
  }
  const access = await getMemberAccess(user.id, membership.workspace_id);
  const allowedClientIds = await visibleClientIds(membership.workspace_id, access?.scope);
  const params = new URL(request.url).searchParams;
  const client = params.get("client") ?? "";
  const range = parseDateRange(Object.fromEntries(params), AGENCY_DEFAULT_RANGE);
  const query = (params.get("q") ?? "").slice(0, 200);

  try {
    const requestedClient = UUID.test(client) ? client : "";
    if (allowedClientIds && requestedClient && !allowedClientIds.includes(requestedClient)) {
      return NextResponse.json({ error: "That client is not in your scope." }, { status: 403 });
    }
    const home = await getAgencyHome(membership.workspace_id, {
      clientId: requestedClient,
      range,
      q: query,
      page: 1,
      allowedClientIds,
    });

    const lines = usageExportLines(home.usage, home.usageHeading).map((row) => csvRow(row));

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="grm-usage-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("usage.export.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to export usage" }, { status: 500 });
  }
}
