import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.NODE_ENV === "production" || process.env.AUTH_DEV_OPEN_SIGNUP !== "true") {
  throw new Error("Demo setup requires local development with AUTH_DEV_OPEN_SIGNUP=true");
}
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  || url.port !== (process.env.LOCAL_POSTGRES_PORT || "55432")) {
  throw new Error("Demo setup only supports the dedicated loopback database");
}
const emailArg = process.argv.indexOf("--email");
const email = emailArg >= 0 ? process.argv[emailArg + 1] : process.env.AUTH_DEV_EMAIL || "local@grm.test";
if (!email?.includes("@")) throw new Error("Provide --email followed by an existing local user's email");
const reset = process.argv.includes("--reset");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  await db.query("BEGIN");
  const { rows: [user] } = await db.query("SELECT id FROM authn.users WHERE lower(email)=lower($1)", [email]);
  if (!user) throw new Error("Sign in locally first, or run db:seed:local to create the local tester");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`local-demo:${user.id}`]);
  const slug = `local-demo-${user.id}`;
  const { rows: [existing] } = await db.query(
    "SELECT id,feature_flags FROM grm_workspaces WHERE slug=$1", [slug]
  );
  if (existing && existing.feature_flags.local_demo !== true) {
    throw new Error("Refusing to change a workspace that is not marked as a local demo");
  }
  if (existing && reset) {
    // Cascades only inside this tester's explicitly marked demo workspace.
    await db.query("DELETE FROM grm_workspaces WHERE id=$1", [existing.id]);
  }
  const { rows: [workspace] } = await db.query(`INSERT INTO grm_workspaces(name,slug,plan,feature_flags)
    VALUES ('Local demo workspace',$1,'lifetime','{"local_demo":true,"automation":false}')
    ON CONFLICT(slug) DO UPDATE SET slug=excluded.slug RETURNING id`, [slug]);
  await db.query("UPDATE grm_workspace_members SET active=false WHERE user_id=$1", [user.id]);
  await db.query(`INSERT INTO grm_workspace_members(workspace_id,user_id,role,active) VALUES ($1,$2,'owner',true)
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true`, [workspace.id, user.id]);
  await db.query(`INSERT INTO grm_onboarding(workspace_id,step) VALUES ($1,'connect')
    ON CONFLICT(workspace_id) DO NOTHING`, [workspace.id]);
  await db.query("COMMIT");
  console.log(reset ? "Demo reset. Your other workspaces were preserved." : "Demo workspace ready. Existing progress was preserved.");
  console.log("Open /onboarding. Connect the demo account, then import a sample location when you are ready.");
  console.log("No locations, reviews, cases or escalations are preloaded.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
