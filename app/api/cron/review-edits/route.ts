import { NextResponse } from "next/server";
import { syncEditedReviews } from "@/lib/services/review-edit-sync";
import { logger } from "@/lib/logger";
import { auditErrorDetails } from "@/lib/audit-details";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await syncEditedReviews());
  } catch (error) {
    logger.error("cron.review_edits_failed", auditErrorDetails(error));
    return NextResponse.json({ error: "Edited-review catch-up could not start. The next scheduled run will retry." }, { status: 503 });
  }
}
