import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { reviewCsvLines, type ReviewExportFilters } from "@/lib/services/review-export";
import { checkRateLimit, EXPORT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const UUID = /^[0-9a-f-]{36}$/i;
const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const MONTH_PERIODS: Record<string, number> = { "3": 3, "6": 6, "12": 12 };

function parseFilters(params: URLSearchParams): ReviewExportFilters {
  const client = params.get("client");
  const location = params.get("location");
  const period = params.get("period") ?? "";
  const months = params.get("months") ?? "";
  const stars = params.get("stars");
  const rating = Number(params.get("rating"));

  let since: string | null = null;
  if (PERIOD_DAYS[period]) {
    since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();
  } else if (MONTH_PERIODS[months]) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMonth(d.getUTCMonth() - (MONTH_PERIODS[months] - 1));
    since = d.toISOString();
  }

  return {
    clientId: client && UUID.test(client) ? client : null,
    locationId: location && UUID.test(location) ? location : null,
    since,
    replyFilter: params.get("filter") ?? "all",
    ratingBucket: stars === "negative" || stars === "positive" ? stars : null,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
  };
}

/** GET /api/reviews/export — CSV of reviews matching the same filters as the inbox. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "reviews.export", EXPORT_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const membership = await ensurePersonalWorkspace(user);
  const filters = parseFilters(new URL(request.url).searchParams);
  const lines = reviewCsvLines(membership.workspace_id, filters);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("\uFEFF"));
      try {
        for await (const line of lines) {
          controller.enqueue(encoder.encode(`${line}\r\n`));
        }
        controller.close();
      } catch (error) {
        logger.error("reviews.export.failed", {
          userId: user.id,
          workspaceId: membership.workspace_id,
          error: error instanceof Error ? error.message : String(error),
        });
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="grm-reviews-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
