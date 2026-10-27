import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/client";
import { runAutomation } from "@/lib/services/reply-settings";
import { logger } from "@/lib/logger";
import { mapPool } from "@/lib/pool";

/** GET /api/cron/automation — drafts or posts only when every automation rule allows it. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_workspaces").select("id");
  if (error) return NextResponse.json({ error: "Could not list workspaces" }, { status: 500 });
  let drafted = 0;
  let published = 0;
  let held = 0;
  await mapPool(data ?? [], 3, async (workspace) => {
    try {
      const result = await runAutomation(workspace.id);
      drafted += result.drafted;
      published += result.published;
      held += result.held;
    } catch (err) {
      logger.error("cron.automation.workspace_failed", {
        workspaceId: workspace.id,
        message: err instanceof Error ? err.message : "Unknown",
      });
    }
  });
  return NextResponse.json({ drafted, published, held });
}
