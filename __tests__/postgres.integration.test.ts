import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool, getAuthPool } from "@/lib/db/pool";
import { createAdminClient } from "@/lib/db/client";
import PostgresAdapter from "@auth/pg-adapter";
import { generateAi } from "@/lib/ai/service";

// Explicit opt-in, loopback-only sandbox. Ordinary npm test never requires a DB
// and never makes a paid AI call.
const enabled = process.env.RUN_DATABASE_TESTS === "1";
describe.skipIf(!enabled)("Postgres integration", () => {
  const ws = randomUUID(), other = randomUUID(), user = randomUUID();
  const client = randomUUID(), location = randomUUID(), review = randomUUID();
  const db = createAdminClient();
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Integration tests require the dedicated local Postgres sandbox");
    await getAuthPool().query('INSERT INTO authn.users(id,email,name) VALUES ($1,$2,$3)', [user, `test-${user}@grm.test`, "Integration tester"]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES ($1,'Integration A',$2),($3,'Integration B',$4)", [ws, `test-${ws}`, other, `test-${other}`]);
    await getPool().query("INSERT INTO grm_clients(id,workspace_id,name) VALUES ($1,$2,'Test shop')", [client, ws]);
    const { rows: [connection] } = await getPool().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at) VALUES ($1,$2,'test@grm.test','test','test',now()) RETURNING id`, [ws, user]);
    const { rows: [account] } = await getPool().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type) VALUES ($1,$2,'accounts/test','Test','LOCATION_GROUP') RETURNING id`, [ws, connection.id]);
    await getPool().query(`INSERT INTO grm_google_locations(id,workspace_id,client_id,google_account_id,google_location_name,location_title) VALUES ($1,$2,$3,$4,'locations/test','Test branch')`, [location, ws, client, account.id]);
  });
  afterAll(async () => {
    if (!process.env.DATABASE_URL) return;
    // A synthetic draft's author uses RESTRICT; clear it before deleting fixtures.
    await getPool().query("DELETE FROM grm_review_replies WHERE workspace_id=$1", [ws]);
    await getPool().query("DELETE FROM grm_review_ai_drafts WHERE workspace_id=$1", [ws]);
    await getPool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, other]]);
    await getAuthPool().query("DELETE FROM authn.users WHERE id=$1", [user]);
    await getPool().end(); await getAuthPool().end();
  });
  it("inserts, upserts and projects nested relations with exact filtered totals", async () => {
    const payload = { id: review, workspace_id: ws, location_id: location, google_review_name: 'reviews/test', google_review_id: 'test', star_rating: 2, comment: 'The queue was slow, but helpful staff.', review_create_time: new Date().toISOString() };
    expect((await db.from("grm_reviews").insert(payload)).error).toBeNull();
    expect((await db.from("grm_reviews").upsert({ ...payload, comment: 'Updated review' }, { onConflict: 'workspace_id,google_review_name' })).error).toBeNull();
    const result = await db.from("grm_reviews").select("id,comment,grm_google_locations!inner(location_title,grm_clients(name))", { count: "exact" }).eq("workspace_id", ws).or('comment.ilike."%Updated%",star_rating.eq.5').range(0, 0);
    expect(result.error).toBeNull(); expect(result.count).toBe(1);
    expect(result.data?.[0]).toMatchObject({ id: review, comment: "Updated review", grm_google_locations: { location_title: "Test branch", grm_clients: { name: "Test shop" } } });
    const hidden = await db.from("grm_reviews").select("id").eq("workspace_id", other).eq("id", review).maybeSingle();
    expect(hidden.error).toBeNull(); expect(hidden.data).toBeNull();
    const emptyPage = await db.from("grm_reviews").select("id", { count: "exact" }).eq("workspace_id", ws).range(100, 110);
    expect(emptyPage.data).toEqual([]); expect(emptyPage.count).toBe(1);
  });
  it("blocks cross-tenant child writes in Postgres", async () => {
    const result = await db.from("grm_reviews").insert({ workspace_id: other, location_id: location, google_review_name: 'reviews/foreign', google_review_id: 'foreign', star_rating: 1, review_create_time: new Date().toISOString() });
    expect(result.error?.code).toBe("23503");
  });
  it("handles atomic compare-and-set writes and literal search injection", async () => {
    const success = await db.from("grm_reviews").update({ comment: "x'); DROP TABLE grm_reviews; --" }).eq("id", review).eq("star_rating", 2).select("id").maybeSingle();
    expect(success.error).toBeNull(); expect(success.data?.id).toBe(review);
    const missed = await db.from("grm_reviews").update({ star_rating: 4 }).eq("id", review).eq("star_rating", 5).select("id").maybeSingle();
    expect(missed.error).toBeNull(); expect(missed.data).toBeNull();
    const count = await db.from("grm_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count.error).toBeNull(); expect(count.count).toBe(1); expect(count.data).toBeNull();
  });
  it("stores JSON arrays as JSON and Postgres arrays as arrays", async () => {
    const inserted = await db.from("grm_insight_reports").insert({ workspace_id: ws, requested_by: user, cache_key: `test-${ws}`, location_ids: [location], range_start: new Date().toISOString(), range_end: new Date(Date.now() + 1000).toISOString(), model: 'test', analysis_version: 'test', prompt_version: 'test', evidence_summary: { total: 1 } }).select("location_ids,evidence_summary").single();
    expect(inserted.error).toBeNull(); expect(inserted.data?.location_ids).toEqual([location]); expect(inserted.data?.evidence_summary).toEqual({ total: 1 });
  });
  it("runs scalar and set-returning analytics functions", async () => {
    const stats = await db.rpc("grm_location_review_stats", { p_workspace_id: ws });
    expect(stats.error).toBeNull(); expect(stats.data?.[0].review_count).toBe(1);
    const bundle = await db.rpc("grm_dashboard_bundle", { p_workspace_id: ws });
    expect(bundle.error).toBeNull(); expect(bundle.data).toBeTypeOf("object");
  });
  it("records concurrent usage once per event without lost monthly increments", async () => {
    const entries = Array.from({ length: 8 }, () => ({ p_event_id: randomUUID(), p_workspace_id: ws, p_month: '2099-01', p_operation: 'reply_draft', p_model: 'test:integration', p_input_tokens: 10, p_output_tokens: 2, p_estimated_usd: 0.0001, p_usage_known: true, p_status: 'completed', p_calls: 1 }));
    const results = await Promise.all([...entries, entries[0], entries[0]].map((entry) => db.rpc("grm_record_ai_usage", entry)));
    expect(results.every((result) => !result.error)).toBe(true);
    const { rows: [totals] } = await getPool().query("SELECT calls,input_tokens FROM grm_ai_usage_monthly WHERE workspace_id=$1 AND month='2099-01'", [ws]);
    expect(totals).toEqual({ calls: 8, input_tokens: 80 });
  });
  it("persists and revokes opaque Auth.js database sessions", async () => {
    const adapter = PostgresAdapter(getAuthPool());
    const sessionToken = randomUUID();
    await adapter.createSession!({ userId: user, sessionToken, expires: new Date(Date.now() + 60000) });
    const loaded = await adapter.getSessionAndUser!(sessionToken);
    expect(loaded?.user.id).toBe(user); expect(loaded?.session.expires).toBeInstanceOf(Date);
    await adapter.deleteSession!(sessionToken);
    expect(await adapter.getSessionAndUser!(sessionToken)).toBeNull();
  });
  it("generates an escalation ticket with the expected initial status", async () => {
    const result = await db.from("grm_escalations").insert({ workspace_id: ws, review_id: review, location_id: location, opened_at: new Date().toISOString(), due_at: new Date(Date.now()+3600000).toISOString(), trigger_key: 'integration', trigger_reasons: ['low_stars'] }).select("ticket_no,status").single();
    expect(result.error).toBeNull(); expect(result.data).toEqual({ ticket_no: 1, status: 'needs_human' });
  });
  it.skipIf(process.env.RUN_AI_SMOKE !== "1")("uses Gemini through the shared SDK and writes the usage ledger", async () => {
    const result = await generateAi({ workspaceId: ws, task: "reply", operation: "reply_draft", prompt: 'Write one short sentence thanking a customer for a review. No introduction.', maxOutputTokens: 128, timeoutMs: 30000, temperature: 0.2 });
    expect(result.text.trim().length).toBeGreaterThan(0);
    const { rows } = await getPool().query("SELECT model,usage_known,status FROM grm_ai_call_events WHERE workspace_id=$1 AND model LIKE 'google:%'", [ws]);
    expect(rows).toHaveLength(1); expect(rows[0].usage_known).toBe(true); expect(rows[0].status).toBe("stop");
  }, 45000);
});
