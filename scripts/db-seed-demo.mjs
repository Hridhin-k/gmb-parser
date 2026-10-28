import nextEnv from "@next/env";
import pg from "pg";
import { createHash } from "node:crypto";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.NODE_ENV === "production" || process.env.AUTH_DEV_OPEN_SIGNUP !== "true") throw new Error("Demo seed requires local development with AUTH_DEV_OPEN_SIGNUP=true");
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== (process.env.LOCAL_POSTGRES_PORT || "55432")) throw new Error("Demo data may only be seeded into a loopback database");
const emailArg = process.argv.findIndex((arg) => arg === "--email");
const email = emailArg >= 0 ? process.argv[emailArg + 1] : process.env.AUTH_DEV_EMAIL || "local@grm.test";
if (!email?.includes("@")) throw new Error("Provide --email followed by an existing local user's email");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  await db.query("BEGIN");
  const { rows: [user] } = await db.query("SELECT id FROM authn.users WHERE lower(email)=lower($1)", [email]);
  if (!user) throw new Error("Sign in locally first, or run db:seed:local to create the local tester");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`local-demo:${user.id}`]);
  const { rows: [workspace] } = await db.query(`INSERT INTO grm_workspaces(name,slug,plan,feature_flags)
    VALUES ('Local demo workspace',$1,'lifetime','{"local_demo":true,"automation":false}')
    ON CONFLICT(slug) DO UPDATE SET slug=excluded.slug RETURNING id`, [`local-demo-${user.id}`]);
  await db.query("UPDATE grm_workspace_members SET active=false WHERE user_id=$1", [user.id]);
  await db.query(`INSERT INTO grm_workspace_members(workspace_id,user_id,role,active) VALUES ($1,$2,'owner',true)
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true`, [workspace.id, user.id]);
  await db.query(`INSERT INTO grm_onboarding(workspace_id,step,completed_at,tone_voice) VALUES ($1,'done',now(),'warm')
    ON CONFLICT(workspace_id) DO NOTHING`, [workspace.id]);
  const { rows: [client] } = await db.query(`SELECT id FROM grm_clients WHERE workspace_id=$1 AND notes='local-demo-v1'`, [workspace.id]);
  const clientId = client?.id || (await db.query(`INSERT INTO grm_clients(workspace_id,name,notes,created_by)
    VALUES ($1,'Demo · Willow & Oak','local-demo-v1',$2) RETURNING id`, [workspace.id, user.id])).rows[0].id;
  const { rows: [brand] } = await db.query(`INSERT INTO grm_brands(workspace_id,client_id,name) VALUES ($1,$2,'Demo · Willow & Oak')
    ON CONFLICT(workspace_id,client_id) DO UPDATE SET name=excluded.name RETURNING id`, [workspace.id, clientId]);
  // Required relational scaffolding, with NO OAuth credentials. A revoked
  // connection is rejected before token decryption or any request to Google.
  const { rows: [connection] } = await db.query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at,status)
    VALUES ($1,$2,'local-demo@grm.invalid','NO_GOOGLE_TOKEN','NO_GOOGLE_TOKEN',now(),'revoked')
    ON CONFLICT(workspace_id,google_email) DO UPDATE SET status='revoked' RETURNING id`, [workspace.id, user.id]);
  const { rows: [account] } = await db.query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type,verification_state)
    VALUES ($1,$2,'local-demo/accounts/store','Local sample data','LOCATION_GROUP','VERIFIED')
    ON CONFLICT(workspace_id,google_account_name) DO UPDATE SET account_display_name=excluded.account_display_name RETURNING id`, [workspace.id, connection.id]);
  const { rows: [location] } = await db.query(`INSERT INTO grm_google_locations(workspace_id,client_id,brand_id,google_account_id,google_location_name,location_title,store_code,address_formatted,voice_of_merchant,is_active,sync_status,last_synced_at)
    VALUES ($1,$2,$3,$4,'local-demo/locations/high-street','Demo · Willow & Oak — High Street','DEMO-001','Sample High Street · Fictional location',true,true,'success',now())
    ON CONFLICT(workspace_id,google_location_name) DO UPDATE SET google_location_name=excluded.google_location_name RETURNING id`, [workspace.id, clientId, brand.id, account.id]);
  const comments = {
    1: ["I waited 35 minutes at checkout and was charged twice. I am still waiting for the refund.", "The item broke the next day and nobody could explain the exchange policy.", "Only one checkout was open. I left without buying after a very long wait."],
    2: ["The staff tried to help, but the billing queue was too long and the price on the shelf was different.", "The size I needed was out of stock. The changing rooms also needed cleaning.", "The return took several visits because different staff gave different answers."],
    3: ["Good range of clothes, but I spent twenty minutes waiting to pay.", "The products were fine. Clearer signs for fitting rooms and returns would help.", "Friendly service, although the store felt crowded and several sizes were missing."],
    4: ["Helpful staff and a good selection. The checkout was a little slow.", "The store was clean and easy to browse. I would like more size options.", "Good quality for the price. The team helped me find a suitable gift."],
    5: ["The team was welcoming and helped me find exactly what I needed. Excellent service.", "Lovely selection, clean fitting rooms and friendly staff. I will visit again.", "Quick checkout and great value. The staff explained the care instructions clearly."],
  };
  const reviewIds = [];
  let added = 0;
  const now = Date.now();
  for (let i = 0; i < 120; i++) {
    // A recent rise in queue/billing complaints makes trends worth exploring.
    const stars = i < 24 ? [1,2,3,4,5,3][i % 6] : [4,5,5,5,4][i % 5];
    const text = comments[stars][Math.floor(i / 5) % comments[stars].length];
    const created = new Date(now - (i * 1.5 + 1) * 86400000).toISOString();
    const replied = i >= 24 && i % 4 === 0;
    const reply = replied ? "Sample reply: Thank you for visiting Willow & Oak. We appreciate your feedback and hope to see you again." : null;
    const fingerprint = hash(`stars:${stars}\ncomment:${text}\ncreated:${created}`);
    const { rows } = await db.query(`INSERT INTO grm_reviews(workspace_id,location_id,google_review_name,google_review_id,reviewer_display_name,star_rating,comment,review_create_time,review_update_time,google_reply_comment,google_reply_update_time,reply_status,review_language,complaint_theme,content_fingerprint,response_fingerprint,sync_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,'en',$12,$13,$14,$13)
      ON CONFLICT(workspace_id,google_review_name) DO NOTHING RETURNING id`, [workspace.id, location.id, `local-demo/reviews/${i+1}`, `demo-${i+1}`, `Demo customer ${String(i+1).padStart(3,'0')}`, stars, text, created, reply, replied ? new Date(Date.parse(created)+7200000).toISOString() : null, replied ? 'published' : 'none', stars <= 3 ? 'queue_time' : null, fingerprint, hash(`reply:${reply || ''}`)]);
    if (rows[0]) { added++; reviewIds.push({id:rows[0].id,stars}); }
  }
  for (const item of reviewIds.filter((r) => r.stars <= 2).slice(0,3)) {
    await db.query(`INSERT INTO grm_escalations(workspace_id,review_id,location_id,opened_at,due_at,trigger_reasons,trigger_key,theme)
      VALUES ($1,$2,$3,now()-interval '3 hours',now()+interval '21 hours','{low_stars}','local-demo-v1','queue_time')
      ON CONFLICT DO NOTHING`, [workspace.id,item.id,location.id]);
  }
  await db.query(`UPDATE grm_google_locations SET total_review_count=s.n,average_rating=s.rating FROM
    (SELECT count(*)::int AS n,round(avg(star_rating),2) AS rating FROM grm_reviews WHERE location_id=$1) s WHERE id=$1`, [location.id]);
  await db.query("COMMIT");
  console.log(`Local demo ready: ${added} new sample reviews. Existing reviews and edits were preserved.`);
  console.log("Workspace: Local demo workspace. Store: Demo · Willow & Oak — High Street.");
  console.log("Open /overview or /reviews. Google sync/publishing are disabled; AI actions use the configured provider.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
