import { Pool, types } from "pg";

// Keep the application's existing string timestamp contract, including JSON projections.
const parsers: Record<number, (value: string) => unknown> = {
  1082: (value) => value,
  1114: (value) => new Date(`${value}Z`).toISOString(),
  1184: (value) => new Date(value).toISOString(),
  1700: Number,
  20: Number,
};

const globalDb = globalThis as unknown as { grmPool?: Pool; grmAuthPool?: Pool };
function makePool(auth = false) {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: auth ? 3 : Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 20_000,
    options: auth ? "-c search_path=authn,public" : "-c search_path=public",
    // Auth.js needs Date instances; domain services use ISO strings.
    types: auth ? undefined : { getTypeParser: (oid, format) => parsers[oid] || types.getTypeParser(oid, format) },
  });
}
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return (globalDb.grmPool ??= makePool());
}
export function getAuthPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return (globalDb.grmAuthPool ??= makePool(true));
}
