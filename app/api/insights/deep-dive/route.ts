import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/date-range";
import { checkRateLimit, AI_GENERATE_LIMIT, WORKSPACE_INSIGHT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { generateFindingDeepDive } from "@/lib/services/deep-dive";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/insights/deep-dive
 * Generates (or reuses) a deep dive for one finding of the current
 * report. A user action only — page views never call this. The model
 * reads at most the finding's 25 cited reviews, and the result is
 * stored on the report so later views are free.
 */
export async function POST(request: Request) {
  const { user, workspaceId } = await getActiveWorkspace();
  const limited = checkRateLimit(user.id, "insights.deep_dive", { ...AI_GENERATE_LIMIT, limit: 10 });
  const workspaceLimited = checkRateLimit(`workspace:${workspaceId}`, "insights.deep_dive", WORKSPACE_INSIGHT_LIMIT);
  if (!limited.allowed || !workspaceLimited.allowed) {
    return NextResponse.json({ notice: "Wait a minute before generating another deep dive." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
  const findingKey = text("findingKey");
  if (!findingKey) {
    return NextResponse.json({ notice: "Which finding to dive into was not specified." }, { status: 400 });
  }
  try {
    const result = await generateFindingDeepDive(createAdminClient(), {
      userId: user.id,
      workspaceId,
      clientId: text("client") || null,
      groupId: text("group") || null,
      locationId: text("location") || null,
      range: parseDateRange({ range: text("range"), from: text("from"), to: text("to") }, "12m"),
      findingKey,
      force: body.force === true,
    });
    if (result.status === "ready") {
      return NextResponse.json({ deepDive: result.deepDive, reused: result.reused });
    }
    const status = result.status === "budget" ? 429 : result.status === "unavailable" ? 404 : 502;
    return NextResponse.json({ notice: result.notice }, { status });
  } catch (error) {
    logger.warn("intelligence.deep_dive_route_failed", {
      workspaceId,
      message: error instanceof Error ? error.message.slice(0, 300) : "deep dive failed",
    });
    return NextResponse.json({ notice: "The deep dive could not be generated. Try again in a moment." }, { status: 500 });
  }
}
