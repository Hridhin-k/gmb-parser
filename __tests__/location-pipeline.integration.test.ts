import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { createAdminClient } from "@/lib/db/client";
import { contentFingerprint } from "@/lib/review-version";
import { loadDailySummaryRange, refreshDailySummaries } from "@/lib/services/daily-insights";
import { enqueueLocationPipelines, pipelineJobViews, runLocationPipeline } from "@/lib/services/location-pipeline";
import { ReviewSyncService } from "@/lib/services/review-sync";
import { generateAi } from "@/lib/ai/service";
import { listUnreadNotices, markNoticeRead } from "@/lib/services/notifications";
import { generateReport, reportCacheKey, requestReport } from "@/lib/services/insight-report";
import { loadTodayDays } from "@/lib/services/today";
import { parseDateRange } from "@/lib/date-range";
import { loadThemeEvidence } from "@/lib/services/insight-drilldown";

// No provider traffic or paid calls. These tests exercise real Postgres locks,
// leases, triggers, transactions, daily partitions and report reuse.
vi.mock("@/lib/ai/service", () => ({ generateAi: vi.fn() }));
vi.mock("@/lib/ai/config", async (original) => ({ ...await original<typeof import("@/lib/ai/config")>(),
  aiConfigured: () => true, aiRouteIdentity: () => "test:daily" }));

const enabled = process.env.RUN_DATABASE_TESTS === "1";
describe.skipIf(!enabled)("durable location pipeline and daily summaries", () => {
  const ws = randomUUID(), otherWs = randomUUID(), user = randomUUID(), client = randomUUID();
  const location = randomUUID(), otherLocation = randomUUID();
  let connection: string;
  const mockAi = vi.mocked(generateAi);
  const db = createAdminClient();
  const scope = { locationIds: [location], start: null, end: null };

  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Dedicated local database required.");
    await getPool().query('INSERT INTO authn.users(id,email,name) VALUES($1,$2,\'Pipeline tester\')', [user, `pipeline-${user}@grm.test`]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Pipeline test',$2),($3,'Other pipeline test',$4)", [ws, `pipeline-${ws}`, otherWs, `pipeline-${otherWs}`]);
    await getPool().query("INSERT INTO grm_clients(id,workspace_id,name) VALUES($1,$2,'Pipeline business')", [client, ws]);
    const { rows: [c] } = await getPool().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
      VALUES($1,$2,'pipeline@test.invalid','test','test',now()) RETURNING id`, [ws, user]);
    connection = c.id;
    const { rows: [account] } = await getPool().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type)
      VALUES($1,$2,$3,'Pipeline','LOCATION_GROUP') RETURNING id`, [ws, connection, `accounts/${randomUUID()}`]);
    await getPool().query(`INSERT INTO grm_google_locations(id,workspace_id,client_id,google_account_id,google_location_name,location_title)
      VALUES($1,$3,$4,$5,'locations/pipeline-a','Selected location'),($2,$3,$4,$5,'locations/pipeline-b','Other location')`, [location, otherLocation, ws, client, account.id]);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockAi.mockReset();
    mockAi.mockImplementation(async ({ prompt, task }) => {
      if (task === "insight") return { text: '{"insights":[]}', model: "test", usage: { inputTokens: 10, outputTokens: 2 } } as Awaited<ReturnType<typeof generateAi>>;
      const ids = [...prompt.matchAll(/REVIEW ([a-f0-9-]+)/g)].map((match) => match[1]);
      return { text: JSON.stringify({ results: ids.map((reviewId) => ({ reviewId, observations: [{ topic: "waiting", sentiment: "negative", evidenceExcerpt: "Long wait", severity: 2, confidence: 0.9 }] })) }),
        model: "test", usage: { inputTokens: 10, outputTokens: 2 } } as Awaited<ReturnType<typeof generateAi>>;
    });
    for (const table of ["grm_location_pipeline_jobs", "grm_insight_reports", "grm_notifications", "grm_reviews", "grm_daily_insights", "grm_insight_days", "grm_analysis_runs"]) {
      await getPool().query(`DELETE FROM ${table} WHERE workspace_id=$1`, [ws]);
    }
    await getPool().query("UPDATE grm_google_locations SET review_timezone=NULL WHERE workspace_id=$1", [ws]);
    await getPool().query("DELETE FROM grm_escalation_policies WHERE workspace_id=$1", [ws]);
    vi.spyOn(ReviewSyncService, "syncLocation").mockResolvedValue({ locationId: location, reviewsSynced: 0, reviewsUpdated: 0, pagesProcessed: 1, truncated: false, mode: "incremental", errorClass: null, errorMessage: null });
  });

  afterAll(async () => {
    if (!enabled) return;
    vi.restoreAllMocks();
    await getPool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, otherWs]]);
    await getPool().query("DELETE FROM authn.users WHERE id=$1", [user]);
    await getPool().end();
  });

  async function review(createdAt = "2026-11-01T10:00:00Z", loc = location, comment: string | null = "Long wait", stars = 2) {
    const id = randomUUID();
    const fingerprint = contentFingerprint({ comment, starRating: stars, createTime: createdAt });
    await getPool().query(`INSERT INTO grm_reviews(id,workspace_id,location_id,google_review_name,google_review_id,star_rating,comment,review_create_time,content_fingerprint)
      VALUES($1::uuid,$2,$3,$4,$1::uuid::text,$5,$6,$7,$8)`, [id, ws, loc, `reviews/${id}`, stars, comment, createdAt, fingerprint]);
    return id;
  }

  it("deduplicates concurrent clicks and rejects cross-workspace locations", async () => {
    const queued = await Promise.all([enqueueLocationPipelines(ws, user, [location]), enqueueLocationPipelines(ws, user, [location])]);
    expect(queued[0]).toEqual(queued[1]);
    expect((await getPool().query("SELECT location_id FROM grm_location_pipeline_jobs WHERE workspace_id=$1", [ws])).rows).toEqual([{ location_id: location }]);
    await expect(enqueueLocationPipelines(otherWs, user, [location])).rejects.toThrow("unavailable");
    expect(await pipelineJobViews(ws, queued[0], [otherLocation])).toEqual([]);
  });

  it("runs only the selected location and reuses its existing analysis on another sync", async () => {
    const id = await review();
    await review(undefined, otherLocation);
    const [job] = await enqueueLocationPipelines(ws, user, [location]);
    await Promise.all([runLocationPipeline(job, ws), runLocationPipeline(job, ws)]);
    expect(ReviewSyncService.syncLocation).toHaveBeenCalledTimes(1);
    expect(ReviewSyncService.syncLocation).toHaveBeenCalledWith(location, connection, ws, user, expect.any(Object));
    expect(mockAi).toHaveBeenCalledTimes(1);
    expect(mockAi.mock.calls[0][0].prompt).toContain(id);
    const summary = await loadDailySummaryRange(ws, scope);
    expect(summary.coverage).toMatchObject({ discovered: 1, analysed: 1, pending: 0 });
    expect(summary.samples[0]?.reviewId).toBe(id);
    expect((await loadThemeEvidence(ws, { ...scope, topic: "waiting", sentiment: "negative" })).map((r) => r.reviewId)).toEqual([id]);
    expect((await pipelineJobViews(ws, [job], [location]))[0]).toMatchObject({ status: "completed", phase: "done" });
    const [again] = await enqueueLocationPipelines(ws, user, [location]);
    await runLocationPipeline(again, ws);
    expect(mockAi).toHaveBeenCalledTimes(1);
  });

  it("resumes a saved fetch checkpoint after an expired worker lease", async () => {
    const [job] = await enqueueLocationPipelines(ws, user, [location]);
    const checkpoint = { mode: "full" as const, startedAt: "2026-11-01T10:00:00Z", pageToken: "page-2", reviewsSynced: 50, reviewsUpdated: 50, freshReviews: 0, pagesProcessed: 1, unchangedPages: 0, seenNames: ["reviews/first-page"] };
    await getPool().query(`UPDATE grm_location_pipeline_jobs SET status='running',lease_until=now()-interval '1 minute',sync_checkpoint=$2::jsonb WHERE id=$1`, [job, JSON.stringify(checkpoint)]);
    await runLocationPipeline(job, ws);
    expect(ReviewSyncService.syncLocation).toHaveBeenCalledWith(location, connection, ws, user, expect.objectContaining({ checkpoint }));
    expect((await pipelineJobViews(ws, [job], [location]))[0].status).toBe("completed");
  });

  it("retries only failed review extraction and keeps successful work", async () => {
    const first = await review();
    const second = await review();
    mockAi.mockResolvedValueOnce({ text: JSON.stringify({ results: [{ reviewId: first, observations: [] }] }), model: "test", usage: { inputTokens: 1, outputTokens: 1 } } as Awaited<ReturnType<typeof generateAi>>);
    const [job] = await enqueueLocationPipelines(ws, user, [location]);
    await runLocationPipeline(job, ws);
    expect((await pipelineJobViews(ws, [job], [location]))[0].status).toBe("queued");
    await getPool().query("UPDATE grm_location_pipeline_jobs SET available_at=now() WHERE id=$1", [job]);
    await runLocationPipeline(job, ws);
    expect(mockAi).toHaveBeenCalledTimes(2);
    expect(mockAi.mock.calls[1][0].prompt).toContain(second);
    expect(mockAi.mock.calls[1][0].prompt).not.toContain(first);
    expect((await loadDailySummaryRange(ws, scope)).coverage).toMatchObject({ analysed: 2, pending: 0 });
  });

  it("partitions by local day and handles exact custom-date boundaries", async () => {
    await review("2026-10-31T19:00:00Z"); // Nov 1 in Kolkata, Oct 31 in UTC.
    const all = await loadDailySummaryRange(ws, scope);
    expect(all.sources.map((s) => s.day)).toEqual(["2026-11-01"]);
    expect(all.aggregates.byMonth[0]?.month).toBe("2026-11");
    expect((await loadDailySummaryRange(ws, { ...scope, start: "2026-11-01T00:00:00Z", end: "2026-11-02T00:00:00Z" })).coverage.discovered).toBe(0);
    expect((await loadDailySummaryRange(ws, { ...scope, start: "2026-10-31T00:00:00Z", end: "2026-11-01T00:00:00Z" })).coverage.discovered).toBe(1);
  });

  it("invalidates only affected days when an old review changes, and excludes removed reviews", async () => {
    const old = await review("2026-09-01T10:00:00Z");
    await review("2026-11-01T10:00:00Z");
    await refreshDailySummaries(ws, [location]);
    const before = (await getPool().query("SELECT day,built_at FROM grm_daily_insights WHERE workspace_id=$1 ORDER BY day", [ws])).rows;
    await getPool().query("UPDATE grm_reviews SET star_rating=1 WHERE id=$1", [old]);
    await refreshDailySummaries(ws, [location]);
    const after = (await getPool().query("SELECT day,built_at FROM grm_daily_insights WHERE workspace_id=$1 ORDER BY day", [ws])).rows;
    expect(after[0].built_at).not.toBe(before[0].built_at);
    expect(after[1].built_at).toBe(before[1].built_at);
    await getPool().query("UPDATE grm_reviews SET missing_on_google_at=now() WHERE id=$1", [old]);
    expect((await loadDailySummaryRange(ws, scope)).coverage.discovered).toBe(1);
  });

  it("moves a review between days without double-counting and leaves reply-only edits reusable", async () => {
    const id = await review();
    const initial = await loadDailySummaryRange(ws, scope);
    await getPool().query("UPDATE grm_reviews SET google_reply_comment='Thank you' WHERE id=$1", [id]);
    expect((await loadDailySummaryRange(ws, scope)).fingerprint).toBe(initial.fingerprint);
    await getPool().query("UPDATE grm_reviews SET review_create_time='2026-11-02T10:00:00Z' WHERE id=$1", [id]);
    const moved = await loadDailySummaryRange(ws, scope);
    expect(moved.coverage.discovered).toBe(1);
    expect(moved.sources.map((s) => s.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect((await loadDailySummaryRange(ws, { ...scope, end: "2026-11-02T00:00:00Z" })).coverage.discovered).toBe(0);
  });

  it("uses the location timezone across DST and rebuilds when that timezone changes", async () => {
    await getPool().query("UPDATE grm_google_locations SET review_timezone='America/New_York' WHERE id=$1", [location]);
    await review("2026-11-01T06:30:00Z");
    const result = await loadDailySummaryRange(ws, scope);
    expect(Date.parse(result.sources[0].end) - Date.parse(result.sources[0].start)).toBe(25 * 60 * 60 * 1000);
    await getPool().query("UPDATE grm_google_locations SET review_timezone='UTC' WHERE id=$1", [location]);
    expect((await loadDailySummaryRange(ws, scope)).sources.every((s) => s.timezone === "UTC")).toBe(true);
  });

  it("generates from saved daily data and makes no new AI call for unchanged reports", async () => {
    await review();
    const [job] = await enqueueLocationPipelines(ws, user, [location]);
    await runLocationPipeline(job, ws);
    const input = { ...scope, locationId: location, clientId: client, groupId: null, prevStart: null, prevEnd: null, scopeLabel: "Selected location" };
    const { reportId } = await requestReport(ws, user, input);
    await generateReport(reportId, ws, input);
    expect(mockAi).toHaveBeenCalledTimes(2); // One extraction, one synthesis.
    const refresh = await requestReport(ws, user, input);
    expect(refresh).toMatchObject({ reportId, status: "pending", action: "generate" });
    expect(await requestReport(ws, user, input)).toMatchObject({ reportId, action: "wait" });
    await generateReport(reportId, ws, input);
    expect(mockAi).toHaveBeenCalledTimes(2);
    const { data } = await db.from("grm_insight_reports").select("status,data_fingerprint,evidence_summary,stale_at").eq("id", reportId).single();
    expect(data?.status).toBe("completed");
    expect(data?.stale_at).toBeNull();
    expect((data?.evidence_summary as { dailySources: unknown[] }).dailySources).toHaveLength(1);
    expect(reportCacheKey(ws, input)).toHaveLength(64);
    await review("2026-11-02T10:00:00Z");
    expect((await db.from("grm_insight_reports").select("stale_at").eq("id", reportId).single()).data?.stale_at).not.toBeNull();
  });

  it("groups duplicate notifications within the selected locations and dismisses the whole group", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i++) await getPool().query(`INSERT INTO grm_notifications(id,workspace_id,user_id,location_id,kind,title,href,dedupe_key)
      VALUES($1::uuid,$2,$3,$4,'sla_reminder','A reminder',$5,$1::uuid::text)`, [ids[i], ws, user, i === 2 ? otherLocation : location, `/escalations/${i === 2 ? "other" : "same"}`]);
    const notices = await listUnreadNotices(ws, user, [location]);
    expect(notices).toHaveLength(1);
    expect(await markNoticeRead(ws, user, notices[0].id)).toBe(true);
    expect(await listUnreadNotices(ws, user, [location])).toEqual([]);
    expect(await listUnreadNotices(ws, user, [otherLocation])).toHaveLength(1);
  });

  it("keeps all-time Today charts populated and scoped without downloading review rows", async () => {
    await review("2025-01-01T10:00:00Z");
    await review("2026-11-01T10:00:00Z");
    await review("2026-11-01T10:00:00Z", otherLocation);
    const now = new Date("2026-11-04T12:00:00Z");
    const days = await loadTodayDays(ws, [location], parseDateRange({ range: "all" }, "3m", now), now, "Asia/Kolkata");
    expect(days[0].day).toBe("2025-01-01");
    expect(days.reduce((n, day) => n + day.reviews, 0)).toBe(2);
  });

  it("invalidates a report when a new review arrives in an initially empty comparison period", async () => {
    await review();
    const input = { ...scope, locationId: location, clientId: client, groupId: null,
      start: "2026-11-01T00:00:00Z", end: "2026-11-04T00:00:00Z",
      prevStart: "2026-10-29T00:00:00Z", prevEnd: "2026-11-01T00:00:00Z", scopeLabel: "Selected location" };
    const { reportId } = await requestReport(ws, user, input);
    await generateReport(reportId, ws, input);
    expect((await db.from("grm_insight_reports").select("stale_at").eq("id", reportId).single()).data?.stale_at).toBeNull();
    await review("2026-10-30T10:00:00Z");
    expect((await db.from("grm_insight_reports").select("stale_at").eq("id", reportId).single()).data?.stale_at).not.toBeNull();
  });

  it("does not regenerate for a rolling boundary shift which contains the same reviews", async () => {
    await review("2026-11-01T10:00:00Z");
    const a = await loadDailySummaryRange(ws, { ...scope, start: "2026-11-01T01:00:00Z" });
    const b = await loadDailySummaryRange(ws, { ...scope, start: "2026-11-01T02:00:00Z" });
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = await loadDailySummaryRange(ws, { ...scope, start: "2026-11-01T11:00:00Z" });
    expect(c.fingerprint).not.toBe(b.fingerprint);
  });

  it("allows workspace deletion to cascade when a timezone policy and summaries exist", async () => {
    await review();
    await getPool().query("INSERT INTO grm_escalation_policies(workspace_id) VALUES($1)", [ws]);
    await loadDailySummaryRange(ws, scope);
    await getPool().query("DELETE FROM grm_workspaces WHERE id=$1", [ws]);
    expect((await getPool().query("SELECT count(*)::integer count FROM grm_insight_days WHERE workspace_id=$1", [ws])).rows[0].count).toBe(0);
  });
});
