import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// A dedicated, loopback-only cluster. Never starts/stops a Homebrew service.
const root = resolve(".local");
const data = resolve(root, "postgres");
const bin = process.env.POSTGRES_BIN || "/opt/homebrew/opt/postgresql@18/bin";
const port = process.env.LOCAL_POSTGRES_PORT || "55432";
const command = process.argv[2] || "start";
mkdirSync(root, { recursive: true, mode: 0o700 });
const run = (name, args) => execFileSync(resolve(bin, name), args, { stdio: "pipe" });
if (command === "stop") {
  run("pg_ctl", ["-D", data, "-m", "fast", "stop"]);
  console.log("Local project Postgres stopped.");
  process.exit(0);
}
const envPath = resolve(".env.local");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
function setIfMissing(key, value) {
  if (parseEnv(env)[key]?.trim()) return;
  env = env.replace(new RegExp(`^${key}=.*\\n?`, "m"), "");
  env += `\n${key}=${value}\n`;
}
if (!existsSync(resolve(data, "PG_VERSION"))) {
  const ownerPassword = randomBytes(24).toString("hex");
  const passwordFile = resolve(root, "init-password");
  writeFileSync(passwordFile, ownerPassword, { mode: 0o600 });
  run("initdb", ["-D", data, "-U", "grm_owner", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]);
  setIfMissing("DATABASE_MIGRATION_URL", `postgresql://grm_owner:${ownerPassword}@127.0.0.1:${port}/grm`);
}
const passwordFile = resolve(root, "init-password");
if (existsSync(passwordFile)) setIfMissing("DATABASE_MIGRATION_URL", `postgresql://grm_owner:${readFileSync(passwordFile, "utf8").trim()}@127.0.0.1:${port}/grm`);
for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"]) {
  const value = parseEnv(env)[key];
  if (value) {
    const url = new URL(value);
    if (url.hostname !== "127.0.0.1" || url.port !== port) throw new Error(`${key} already points at a different database; use db:migrate for an existing server`);
  }
}
try { run("pg_ctl", ["-D", data, "status"]); }
catch { run("pg_ctl", ["-D", data, "-l", resolve(root, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1 -k ${root}`, "start"]); }
setIfMissing("AUTH_SECRET", randomBytes(32).toString("hex"));
setIfMissing("AUTH_URL", "http://localhost:3001");
setIfMissing("AUTH_DEV_LOGIN", "true");
setIfMissing("AUTH_DEV_LOGIN_TOKEN", randomBytes(32).toString("hex"));
const appPassword = randomBytes(24).toString("hex");
setIfMissing("DATABASE_URL", `postgresql://grm_app:${appPassword}@127.0.0.1:${port}/grm`);
writeFileSync(envPath, env, { mode: 0o600 });
chmodSync(envPath, 0o600);
const migrationUrl = new URL(parseEnv(env).DATABASE_MIGRATION_URL);
const { default: pg } = await import("pg");
const owner = new pg.Client({ connectionString: new URL("postgres", migrationUrl).toString() });
await owner.connect();
if (!(await owner.query("select 1 from pg_database where datname='grm'")).rowCount) await owner.query("create database grm");
if (!(await owner.query("select 1 from pg_roles where rolname='grm_app'")).rowCount) {
  const password = new URL(parseEnv(env).DATABASE_URL).password;
  // Password is generated hex, never user-supplied SQL.
  if (!/^[a-f0-9]{48}$/.test(password)) throw new Error("Expected generated local app password");
  await owner.query(`create role grm_app login password '${password}' nosuperuser nocreatedb nocreaterole`);
}
await owner.end();
console.log(`Project Postgres is listening on 127.0.0.1:${port}. Private settings are in .env.local.`);
