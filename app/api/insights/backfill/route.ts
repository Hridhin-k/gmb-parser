import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/date-range";
import { checkRateLimit, AI_GENERATE_LIMIT, WORKSPACE_INSIGHT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { readScopeRequest } from "@/lib/scope";
import { authorizeSummaryScope, SummaryAccessError } from "@/lib/intelligence/summary-scope";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { summaryWindowMonths, summaryWindowStart } from "@/lib/intelligence/backfill-plan";
import { loadReviewIdsSince, runScopeBackfill } from "@/lib/services/intelligence-backfill";
import { getBackfillProgress, patchBackfillProgress, tryStartBackfill } from "@/lib/services/backfill-progress";
import { updateOrgSummary } from "@/lib/services/org-summary";
import { generateInsightReport } from "@/lib/services/insight-report";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * POST /api/insights/backfill
 * Updates the organisation summary — the source of truth — for the whole
 * organisation behind the current scope: topics are extracted for any
 * reviews not yet merged (rules first, batched model calls for residue),
 * the delta is merged incrementally into the stored organisation summary,
 * and the current view's report is regenerated as a slice of it. Fazyo
 * replaces the stored summary with the last 6 months and embeds every one
 * of those reviews that has text so topic clusters can be stored. A page
 * view never calls this.
 */
export async function POST(request: Request) {
  const { user, workspaceId } = await getActiveWorkspace();
  const form = await request.formData();
  const back = new URL("/insights", request.url);
  for (const key of ["range", "from", "to", "client", "group", "location"] as const) {
    const value = field(form, key);
    if (value) back.searchParams.set(key, value);
  }
  const limited = checkRateLimit(user.id, "insights.backfill", { ...AI_GENERATE_LIMIT, limit: 3 });
  const workspaceLimited = checkRateLimit(`workspace:${workspaceId}`, "insights.backfill", WORKSPACE_INSIGHT_LIMIT);
  if (!limited.allowed || !workspaceLimited.allowed) {
    back.searchParams.set("notice", "Wait a minute before updating review data again.");
    return NextResponse.redirect(back, 303);
  }
  const wantsJson = request.headers.get("x-backfill-json") === "1";
  const admin = createAdminClient();
  try {
    const catalog = await loadScopeCatalog(user.id, workspaceId);
    if (!catalog) throw new SummaryAccessError();
    const scope = authorizeSummaryScope(
      catalog,
      readScopeRequest({
        client: field(form, "client") || null,
        group: field(form, "group") || null,
        location: field(form, "location") || null,
      })
    );
    const started = tryStartBackfill(workspaceId, {
      clientId: scope.clientId,
      phase: "extracting",
      pendingBefore: 0,
      processed: 0,
      rulesStored: 0,
      batchStored: 0,
      remaining: 0,
      notice: null,
      startedAt: new Date().toISOString(),
    });
    if (!started) {
      // Another tab or click already owns this update. Starting a second
      // run would share one progress display and double-spend model calls.
      const active = getBackfillProgress(workspaceId, scope.clientId);
      const notice = "An update is already running for this workspace. Watch its progress here instead of starting another.";
      logger.info("intelligence.backfill_already_running", { workspaceId });
      if (wantsJson) {
        return NextResponse.json({ notice, alreadyRunning: true, ...(active ?? {}) });
      }
      back.searchParams.set("notice", notice);
      return NextResponse.redirect(back, 303);
    }
    // The update is organisation-wide, whatever scope is on screen: every
    // location of the client, newest reviews first, in bounded passes.
    const { data: clientLocations } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("client_id", scope.clientId);
    const orgLocationIds =
      clientLocations && clientLocations.length > 0 ? clientLocations.map((row) => row.id) : scope.locationIds;
    const { data: clientRow } = await admin
      .from("grm_clients")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("id", scope.clientId)
      .maybeSingle();
    const windowMonths = summaryWindowMonths(clientRow?.name);
    const summaryReviewIds = windowMonths
      ? await loadReviewIdsSince(admin, workspaceId, orgLocationIds, summaryWindowStart(windowMonths, new Date()))
      : undefined;
    const reviewIds = summaryReviewIds && summaryReviewIds.length > 0 ? summaryReviewIds : undefined;
    const aggregate = {
      pendingBefore: 0,
      processed: 0,
      rulesStored: 0,
      batchStored: 0,
      remaining: 0,
      budgetStopped: false,
      quotaStopped: false,
    };
    for (let pass = 0; pass < 10; pass += 1) {
      const passBase = { ...aggregate };
      const result = await runScopeBackfill(admin, {
        workspaceId,
        locationIds: orgLocationIds,
        reviewIds,
        onProgress: (progress) => {
          patchBackfillProgress(workspaceId, {
            phase: "extracting",
            pendingBefore: passBase.pendingBefore || progress.rulesStored + progress.batchStored + progress.failed,
            processed: passBase.processed + progress.rulesStored + progress.batchStored,
            rulesStored: passBase.rulesStored + progress.rulesStored,
            batchStored: passBase.batchStored + progress.batchStored,
          });
        },
      });
      if (pass === 0) aggregate.pendingBefore = result.pendingBefore;
      aggregate.processed += result.processed;
      aggregate.rulesStored += result.rulesStored;
      aggregate.batchStored += result.batchStored;
      aggregate.remaining = result.remaining;
      aggregate.budgetStopped = result.budgetStopped;
      aggregate.quotaStopped = result.quotaStopped;
      patchBackfillProgress(workspaceId, {
        pendingBefore: aggregate.pendingBefore,
        processed: aggregate.processed,
        rulesStored: aggregate.rulesStored,
        batchStored: aggregate.batchStored,
        remaining: aggregate.remaining,
      });
      if (result.remaining === 0 || result.processed === 0 || result.quotaStopped) break;
    }
    const result = aggregate;
    let embedded = { stored: 0, reused: 0, failed: 0, quotaStopped: false, budgetStopped: false };
    let clusterCount = 0;
    if (reviewIds) {
      patchBackfillProgress(workspaceId, { phase: "embedding", remaining: result.remaining });
      const { embedReviewSet, rebuildWorkspaceClusters } = await import("@/lib/services/intelligence-embed");
      embedded = await embedReviewSet(admin, workspaceId, reviewIds, () => {
        patchBackfillProgress(workspaceId, { phase: "embedding" });
      });
      if (embedded.stored > 0 || embedded.reused > 0) {
        clusterCount = await rebuildWorkspaceClusters(admin, workspaceId);
      }
    }
    patchBackfillProgress(workspaceId, { phase: "merging", remaining: result.remaining });
    // The first complete pass after this reading change recounts every review.
    // Later passes add and merge only reviews that are new, changed, or gone.
    const extractionComplete = result.remaining === 0 && !result.budgetStopped && !result.quotaStopped;
    const orgUpdate = await updateOrgSummary(admin, {
      workspaceId,
      clientId: scope.clientId,
      locationIds: orgLocationIds,
      extractionComplete,
      reviewIds,
      windowMonths: windowMonths ?? undefined,
    });
    patchBackfillProgress(workspaceId, { phase: "regenerating" });
    await generateInsightReport(admin, {
      userId: user.id,
      workspaceId,
      clientId: field(form, "client") || null,
      groupId: field(form, "group") || null,
      locationId: field(form, "location") || null,
      range: parseDateRange({ range: field(form, "range"), from: field(form, "from"), to: field(form, "to") }, "12m"),
      force: result.processed > 0 || orgUpdate.rewritten || embedded.stored > 0,
    });
    const orgSentence = orgUpdate.unavailable
      ? "The organisation summary table is not installed yet (apply migration 20261020011), so the extraction was stored per review but not merged into the summary."
      : orgUpdate.rewritten && extractionComplete
        ? `Organisation summary rebuilt from ${orgUpdate.totalReviews} reviews. Further updates add and merge only new reviews.`
        : orgUpdate.rewritten
          ? `Organisation summary recount is in progress (${orgUpdate.totalReviews} reviews so far). It stays a full recount until every review has been read.`
          : orgUpdate.changed
            ? `Organisation summary updated: ${orgUpdate.added} new reviews added, ${orgUpdate.updated} changed, ${orgUpdate.removed} removed (${orgUpdate.totalReviews} reviews in the summary).`
            : `Organisation summary already holds all ${orgUpdate.totalReviews} reviews.`;
    const notice =
      result.pendingBefore === 0
        ? `${orgSentence} The report was checked against it.`
        : result.remaining === 0
          ? `${orgSentence} ${result.processed} reviews were extracted first (${result.rulesStored} by rules, ${result.batchStored} by AI batch).`
          : `${orgSentence} Extraction is partial: ${result.processed} reviews processed, ${result.remaining} still pending${
              result.budgetStopped ? " (monthly AI budget reached)" : result.quotaStopped ? " (AI quota reached)" : ""
            }. Click Update summary again to continue.`;
    const windowSentence = reviewIds
      ? ` This replaces the previous summary with the last ${windowMonths} months (${reviewIds.length.toLocaleString("en-US")} reviews).`
      : "";
    const clusterSentence = reviewIds
      ? embedded.quotaStopped || embedded.budgetStopped
        ? ` Topic clusters paused after embedding ${embedded.stored.toLocaleString("en-US")} text reviews${embedded.quotaStopped ? " (AI quota reached)" : " (monthly AI budget reached)"}. Click Update summary again to continue.`
        : ` Topic clusters use ${embedded.stored.toLocaleString("en-US")} newly embedded text reviews${embedded.reused > 0 ? ` and ${embedded.reused.toLocaleString("en-US")} already stored` : ""}, in ${clusterCount.toLocaleString("en-US")} groups.`
      : "";
    const fullNotice = `${notice}${windowSentence}${clusterSentence}`;
    patchBackfillProgress(workspaceId, { phase: "done", notice: fullNotice, remaining: result.remaining });
    if (wantsJson) {
      return NextResponse.json({ notice: fullNotice, ...result, org: orgUpdate, embedded, clusterCount });
    }
    back.searchParams.set("notice", fullNotice);
  } catch (error) {
    const message =
      error instanceof SummaryAccessError ? error.message : "Review data could not be updated. Try again in a moment.";
    patchBackfillProgress(workspaceId, { phase: "failed", notice: message });
    if (wantsJson) {
      return NextResponse.json({ notice: message }, { status: 500 });
    }
    if (error instanceof SummaryAccessError) {
      back.searchParams.set("notice", error.message);
    } else {
      logger.warn("intelligence.backfill_route_failed", {
        message: error instanceof Error ? error.message : "backfill failed",
      });
      back.searchParams.set("notice", "Review data could not be updated. Try again in a moment.");
    }
  }
  return NextResponse.redirect(back, 303);
}
