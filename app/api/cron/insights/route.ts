import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { aiConfigured } from "@/lib/ai/config";
import { ANALYSIS_VERSION } from "@/lib/review-intelligence";
import { DAILY_SUMMARY_VERSION } from "@/lib/daily-insights";
import { enqueueLocationPipelines, drainLocationPipelines } from "@/lib/services/location-pipeline";

export const maxDuration = 300;

/** Backfill missing analysis/summaries through the same durable location queue.
 * Successful history is reused; there is no six-month cut-off. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!aiConfigured("extract")) return NextResponse.json({ skipped: "AI is not configured", queued: 0 });
  const { rows } = await getPool().query<{ id: string; workspace_id: string; user_id: string }>(`
    SELECT l.id,l.workspace_id,c.authorized_by_user_id user_id FROM grm_google_locations l
    JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
    JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
    WHERE l.is_active AND c.status='active' AND (
      EXISTS(SELECT 1 FROM grm_reviews r LEFT JOIN grm_review_analyses a
        ON a.workspace_id=r.workspace_id AND a.review_id=r.id AND a.analysis_version=$1
        WHERE r.workspace_id=l.workspace_id AND r.location_id=l.id AND r.missing_on_google_at IS NULL
          AND btrim(coalesce(r.comment,''))<>'' AND (a.status IS DISTINCT FROM 'ready'
            OR r.content_fingerprint IS NOT NULL AND a.content_fingerprint IS DISTINCT FROM r.content_fingerprint))
      OR EXISTS(SELECT 1 FROM grm_insight_days d LEFT JOIN grm_daily_insights s
        ON s.workspace_id=d.workspace_id AND s.location_id=d.location_id AND s.day=d.day AND s.timezone=d.timezone
          AND s.analysis_version=$1 AND s.summary_version=$2
        WHERE d.workspace_id=l.workspace_id AND d.location_id=l.id
          AND d.timezone=grm_review_timezone(d.workspace_id,d.location_id)
          AND (s.source_revision IS NULL OR s.source_revision<>d.revision)))`, [ANALYSIS_VERSION, DAILY_SUMMARY_VERSION]);
  let queued = 0;
  for (const location of rows) {
    queued += (await enqueueLocationPipelines(location.workspace_id, location.user_id, [location.id])).length;
  }
  await drainLocationPipelines({ limit: 2 });
  return NextResponse.json({ queued });
}
