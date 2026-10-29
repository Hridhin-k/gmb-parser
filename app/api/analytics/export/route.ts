import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { parseDateRange } from "@/lib/date-range";
import { buildLeaderboardExportRows, leaderboardExportLines } from "@/lib/analytics-export";
import type { RankBy, RankShow } from "@/lib/analytics-metrics";
import { csvRow } from "@/lib/services/review-export";
import { checkRateLimit, EXPORT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

const DEFAULT_RANGE = "12m";

/** GET /api/analytics/export — CSV of the Analytics Performance leaderboard. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "analytics.export", EXPORT_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const membership = await ensurePersonalWorkspace(user);
  const search = new URL(request.url).searchParams;
  const raw = Object.fromEntries(search);
  const range = parseDateRange(raw, DEFAULT_RANGE);
  const rankBy: RankBy =
    search.get("rankBy") === "reviews" ||
    search.get("rankBy") === "reply" ||
    search.get("rankBy") === "time"
      ? (search.get("rankBy") as RankBy)
      : "rating";
  const show: RankShow = search.get("show") === "groups" ? "groups" : "locations";

  try {
    const resolved = await readPageScope(user.id, membership.workspace_id, {
      client: search.get("client") ?? undefined,
      group: search.get("group") ?? undefined,
      location: search.get("location") ?? undefined,
    });
    const context = await getDashboardContext(membership.workspace_id, range, {
      clientId: resolved.clientId,
      groupId: resolved.groupId,
      locationId: resolved.locationId,
    });

    const locationsInScope = context.locations.filter((location) => {
      if (resolved.locationId) return location.id === resolved.locationId;
      if (resolved.groupId) {
        return location.groupId === resolved.groupId || location.parentGroupId === resolved.groupId;
      }
      if (resolved.clientId) return location.clientId === resolved.clientId;
      return true;
    });
    const locationNames = new Map(locationsInScope.map((location) => [location.id, location.name]));
    const groupNames = new Map(context.groups.map((group) => [group.id, group.name]));

    const rows = buildLeaderboardExportRows({
      facts: context.facts,
      locationNames,
      groupNames,
      groupOf: (locationId) =>
        context.locations.find((location) => location.id === locationId)?.groupId ?? null,
      parentOf: (groupId) =>
        context.locations.find((location) => location.groupId === groupId)?.parentGroupId ?? null,
      rankBy,
      show,
    });
    const lines = leaderboardExportLines(rows, show).map((row) => csvRow(row));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="grm-analytics-leaderboard-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("analytics.export.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to export analytics" }, { status: 500 });
  }
}
