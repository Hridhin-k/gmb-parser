import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { checkRateLimit, AI_GENERATE_LIMIT, WORKSPACE_AI_LIMIT } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { parseDateRange, previousDateRange } from "@/lib/date-range";
import { generateReport, requestReport } from "@/lib/services/insight-report";
import { logger } from "@/lib/logger";

// Synthesis for a large scope is one long AI call (100s+). The route
// needs a ceiling well above that or the platform kills generation
// mid-synthesis; progress is saved on the report row either way and the
// status poll resumes a stalled report.
export const maxDuration = 300;

/**
 * POST /api/insights/report
 *
 * Requests an insight report for the caller's resolved scope and range.
 * The scope is re-resolved on the server; the report row is keyed by a
 * normalised cache identity, so identical filters with unchanged data
 * reuse the saved report without new AI calls. Generation (missing
 * review analysis, then synthesis) runs in `after()`; poll the status
 * route for progress.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = checkRateLimit(user.id, "ai.generate", AI_GENERATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait before generating again." },
      { status: 429 }
    );
  }

  const membership = await ensurePersonalWorkspace(user);
  const workspaceId = membership.workspace_id as string;
  const workspaceLimit = checkRateLimit(
    `workspace:${workspaceId}`,
    "ai.generate",
    WORKSPACE_AI_LIMIT
  );
  if (!workspaceLimit.allowed) {
    return NextResponse.json(
      { error: "This workspace has reached its AI limit. Please wait before generating again." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const scope = await readPageScope(user.id, workspaceId, {
    client: typeof body.client === "string" ? body.client : undefined,
    group: typeof body.group === "string" ? body.group : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
  });
  if (scope.locationIds.length === 0) {
    return NextResponse.json(
      { error: "No locations in the selected scope. Choose a client, group, or outlet first." },
      { status: 400 }
    );
  }

  const range = parseDateRange(
    {
      range: typeof body.range === "string" ? body.range : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
    },
    "12m"
  );
  const previous = previousDateRange(range);

  const input = {
    locationIds: scope.locationIds,
    clientId: scope.clientId,
    groupId: scope.groupId,
    locationId: scope.locationId,
    start: range.start ? range.start.toISOString() : null,
    end: range.end ? range.end.toISOString() : null,
    prevStart: previous ? previous.start.toISOString() : null,
    prevEnd: previous ? previous.end.toISOString() : null,
    scopeLabel: scope.title,
  };

  try {
    const { reportId, status, action } = await requestReport(workspaceId, user.id, input);
    if (action === "generate") {
      after(async () => {
        await generateReport(reportId, workspaceId, input);
      });
    }
    return NextResponse.json({ reportId, status, action });
  } catch (error) {
    logger.error("insight_report.start_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to start the report. Please try again." },
      { status: 500 }
    );
  }
}
