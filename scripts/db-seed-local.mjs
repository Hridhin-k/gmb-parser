import nextEnv from "@next/env";
import pg from "pg";
nextEnv.loadEnvConfig(process.cwd());
if (process.env.NODE_ENV === "production" || process.env.AUTH_DEV_LOGIN !== "true") throw new Error("Local seed requires AUTH_DEV_LOGIN=true outside production");
const url = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local seed only supports a loopback database");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  await db.query("BEGIN");
  const { rows: [user] } = await db.query(`INSERT INTO authn.users(email,name,"emailVerified") VALUES ($1,'Local tester',now())
    ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id`, [process.env.AUTH_DEV_EMAIL || "local@grm.test"]);
  const { rows: [workspace] } = await db.query(`INSERT INTO public.grm_workspaces(name,slug,plan) VALUES ('Local test workspace','local-test','lifetime')
    ON CONFLICT(slug) DO UPDATE SET slug=excluded.slug RETURNING id`);
  await db.query(`INSERT INTO public.grm_workspace_members(workspace_id,user_id,role,active) VALUES ($1,$2,'owner',true) ON CONFLICT(workspace_id,user_id) DO NOTHING`, [workspace.id, user.id]);
  // A local sandbox can open all pages without an actual GBP connection.
  await db.query(`INSERT INTO public.grm_onboarding(workspace_id,step,completed_at) VALUES ($1,'done',now()) ON CONFLICT(workspace_id) DO NOTHING`, [workspace.id]);
  await db.query("COMMIT");
  console.log("Local test user and empty workspace are ready. Use the local test button on /login.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
