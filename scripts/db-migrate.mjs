import nextEnv from "@next/env";
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_MIGRATION_URL or DATABASE_URL");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(192819, 1)");
  await db.query("CREATE SCHEMA IF NOT EXISTS ops");
  await db.query("CREATE TABLE IF NOT EXISTS ops.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of readdirSync("db/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve("db/migrations", name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const { rows: [applied] } = await db.query("SELECT checksum FROM ops.schema_migrations WHERE name=$1", [name]);
    if (applied) {
      if (applied.checksum !== checksum) throw new Error(`Applied migration was edited: ${name}`);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query("INSERT INTO ops.schema_migrations(name,checksum) VALUES ($1,$2)", [name, checksum]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    console.log(`Applied ${name}`);
  }
  // The runtime role has data/function access, never cluster administration or
  // schema ownership. A separate migration connection is recommended.
  const runtimeRole = new URL(process.env.DATABASE_URL || url).username;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(runtimeRole)) throw new Error("Unsupported runtime role identifier");
  const role = `"${runtimeRole}"`;
  await db.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public,authn TO ${role};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,authn TO ${role};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,authn TO ${role};
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role};`);
  console.log("Database is up to date.");
} finally {
  await db.query("SELECT pg_advisory_unlock(192819,1)");
  await db.end();
}
