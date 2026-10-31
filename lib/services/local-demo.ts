import { createHash } from "node:crypto";
import { localSignupEnabled } from "@/lib/auth/dev-login";
import { getPool } from "@/lib/db/pool";
import { AuthorizationError, ValidationError } from "@/lib/errors";

export const DEMO_EMAIL = "local-demo@grm.invalid";

export function localDemoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!localSignupEnabled(env)) return false;
  try {
    const url = new URL(env.DATABASE_URL || "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.port === (env.LOCAL_POSTGRES_PORT || "55432");
  } catch { return false; }
}

export async function isLocalDemoWorkspace(workspaceId: string): Promise<boolean> {
  if (!localDemoEnabled()) return false;
  const { rows } = await getPool().query(
    "SELECT 1 FROM grm_workspaces WHERE id=$1 AND feature_flags->>'local_demo'='true'",
    [workspaceId]
  );
  return rows.length > 0;
}

/** Sample data is added only when the tester chooses the corresponding setup step. */
export async function advanceLocalDemo(workspaceId: string, userId: string, action: "demo-connect" | "demo-import") {
  if (!localDemoEnabled()) throw new AuthorizationError("Demo setup is only available locally.");
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`local-demo:${workspaceId}`]);
    const { rows: members } = await db.query(`SELECT 1 FROM grm_workspace_members m
      JOIN grm_workspaces w ON w.id=m.workspace_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active=true
      AND m.role IN ('owner','admin','org_admin') AND w.status='active'
      AND w.feature_flags->>'local_demo'='true'`, [workspaceId, userId]);
    if (!members.length) throw new AuthorizationError("Only a demo workspace admin can run demo setup.");

    if (action === "demo-connect") {
      // Keep the fixture revoked: real sync/publish code rejects it before reading tokens.
      await db.query(`INSERT INTO grm_google_connections
        (workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at,status)
        VALUES ($1,$2,$3,'NO_GOOGLE_TOKEN','NO_GOOGLE_TOKEN',now(),'revoked')
        ON CONFLICT(workspace_id,google_email) DO NOTHING`, [workspaceId, userId, DEMO_EMAIL]);
      await db.query("UPDATE grm_onboarding SET step='import' WHERE workspace_id=$1", [workspaceId]);
    } else {
      const { rows: [connection] } = await db.query(
        "SELECT id FROM grm_google_connections WHERE workspace_id=$1 AND google_email=$2 AND access_token_enc='NO_GOOGLE_TOKEN'",
        [workspaceId, DEMO_EMAIL]
      );
      if (!connection) throw new ValidationError("Connect the demo account first.");
      const { rows: [existing] } = await db.query(
        "SELECT id FROM grm_clients WHERE workspace_id=$1 AND notes='local-demo-onboarding'", [workspaceId]
      );
      const clientId = existing?.id ?? (await db.query(`INSERT INTO grm_clients(workspace_id,name,notes,created_by)
        VALUES ($1,'Willow & Oak','local-demo-onboarding',$2) RETURNING id`, [workspaceId, userId])).rows[0].id;
      const { rows: [brand] } = await db.query(`INSERT INTO grm_brands(workspace_id,client_id,name)
        VALUES ($1,$2,'Willow & Oak') ON CONFLICT(workspace_id,client_id) DO UPDATE SET name=excluded.name RETURNING id`,
      [workspaceId, clientId]);
      const { rows: [account] } = await db.query(`INSERT INTO grm_google_accounts
        (workspace_id,connection_id,google_account_name,account_display_name,account_type,verification_state)
        VALUES ($1,$2,'local-demo/accounts/store','Demo account','LOCATION_GROUP','VERIFIED')
        ON CONFLICT(workspace_id,google_account_name) DO UPDATE SET account_display_name=excluded.account_display_name RETURNING id`,
      [workspaceId, connection.id]);
      const { rows: [location] } = await db.query(`INSERT INTO grm_google_locations
        (workspace_id,client_id,brand_id,google_account_id,google_location_name,location_title,store_code,address_formatted,
         voice_of_merchant,is_active,sync_status,last_synced_at)
        VALUES ($1,$2,$3,$4,'local-demo/locations/high-street','Willow & Oak — High Street','DEMO-001',
          '10 High Street, London, Greater London, SW1A 1AA, UK',true,true,'success',now())
        ON CONFLICT(workspace_id,google_location_name) DO UPDATE SET google_location_name=excluded.google_location_name RETURNING id`,
      [workspaceId, clientId, brand.id, account.id]);
      const reviews = [
        [5, "Welcoming staff and a lovely selection. I found exactly what I needed."],
        [4, "Good quality and helpful service. A few more sizes would be welcome."],
        [5, "Clean fitting rooms and a quick checkout. I'll visit again."],
        [4, "A good place to shop for gifts. The team gave thoughtful advice."],
        [5, "Friendly service from start to finish. Thank you!"],
        [4, "Easy to browse and good value. A pleasant shopping trip."],
      ] as const;
      for (const [index, [stars, comment]] of reviews.entries()) {
        const created = new Date(Date.now() - (index * 3 + 1) * 86_400_000).toISOString();
        const fingerprint = createHash("sha256").update(`${stars}:${comment}`).digest("hex");
        await db.query(`INSERT INTO grm_reviews
          (workspace_id,location_id,google_review_name,google_review_id,reviewer_display_name,star_rating,comment,
           review_create_time,review_update_time,reply_status,review_language,content_fingerprint,response_fingerprint,sync_hash)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'none','en',$9,$9,$9)
          ON CONFLICT(workspace_id,google_review_name) DO NOTHING`,
        [workspaceId, location.id, `local-demo/reviews/${index + 1}`, `demo-${index + 1}`,
          `Demo customer ${index + 1}`, stars, comment, created, fingerprint]);
      }
      await db.query(`UPDATE grm_google_locations SET total_review_count=s.n,average_rating=s.rating FROM
        (SELECT count(*)::int n,round(avg(star_rating),2) rating FROM grm_reviews WHERE location_id=$1) s WHERE id=$1`, [location.id]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
