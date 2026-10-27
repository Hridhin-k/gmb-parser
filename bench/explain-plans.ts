import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  extractFunctionBody,
  isExplainableQuery,
  sha256,
  splitSqlStatements,
  toPlaceholders,
  withoutSelectInto,
} from "./extract-sql";
import { decideTarget, discardGeminiCredentials, redactDatabaseUrl, serverAddressAllowed } from "./safety";
import { bindWorkload, WORKLOADS, type WorkloadContext } from "./workloads";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "bench", "results", "plans", new Date().toISOString().replace(/[:.]/g, "-"));

type PlanRecord = {
  id: string;
  source: string;
  status: "ok" | "failed";
  sqlFile: string;
  planFile: string | null;
  sha256: string;
  bytes: number;
  planningMs: number | null;
  executionMs: number | null;
  pass1ExecutionMs: number | null;
  bufferCache: "warm";
  note: string;
};

function requireFile(file: string): string {
  const info = statSync(file, { throwIfNoEntry: false });
  if (!info || !info.isFile() || info.size === 0) {
    throw new Error(`Expected a nonempty file at ${file}`);
  }
  return readFileSync(file, "utf8");
}

function writeSql(name: string, sql: string, source: string, extra = ""): { file: string; checksum: string; bytes: number } {
  const file = path.join(outDir, `${name}.sql`);
  const header = `-- source: ${source}\n${extra}-- sha256 of the statement below\n`;
  const statement = sql.trim();
  if (!statement) throw new Error(`Extraction produced an empty statement for ${name} from ${source}`);
  writeFileSync(file, `${header}${statement}\n`);
  const written = requireFile(file);
  if (!written.includes(statement)) throw new Error(`Wrote ${file} but the statement was not stored.`);
  return { file, checksum: sha256(statement), bytes: Buffer.byteLength(statement) };
}

function timings(plan: string): { planningMs: number; executionMs: number } {
  const planning = plan.match(/Planning Time:\s+([0-9.]+)\s+ms/);
  const execution = plan.match(/Execution Time:\s+([0-9.]+)\s+ms/);
  if (!planning || !execution) {
    throw new Error(`Plan text is missing Planning Time or Execution Time. First line: ${plan.split("\n")[0] ?? "(empty)"}`);
  }
  return { planningMs: Number(planning[1]), executionMs: Number(execution[1]) };
}

async function explain(client: pg.PoolClient, name: string, sql: string, params: unknown[], source: string, note: string): Promise<PlanRecord> {
  const saved = writeSql(name, sql, source);
  const text = `explain (analyze, buffers, verbose, settings)\n${sql.trim()}`;
  let pass1: number | null = null;
  let plan = "";
  try {
    const planText = (result: pg.QueryResult) =>
      result.rows.map((row) => String(Object.values(row)[0] ?? "")).join("\n");
    const first = await client.query(text, params);
    pass1 = timings(planText(first)).executionMs;
    const second = await client.query(text, params);
    plan = planText(second);
    const parsed = timings(plan);
    const planFile = path.join(outDir, `${name}.plan.txt`);
    writeFileSync(planFile, `${plan}\n`);
    requireFile(planFile);
    return {
      id: name,
      source,
      status: "ok",
      sqlFile: saved.file,
      planFile,
      sha256: saved.checksum,
      bytes: saved.bytes,
      planningMs: parsed.planningMs,
      executionMs: parsed.executionMs,
      pass1ExecutionMs: pass1,
      bufferCache: "warm",
      note,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: name,
      source,
      status: "failed",
      sqlFile: saved.file,
      planFile: null,
      sha256: saved.checksum,
      bytes: saved.bytes,
      planningMs: null,
      executionMs: null,
      pass1ExecutionMs: pass1,
      bufferCache: "warm",
      note: message,
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidLiteral(value: string): string {
  if (!UUID.test(value)) throw new Error(`Refusing to embed a non-UUID value: ${value}`);
  return `'${value}'::uuid`;
}

type PreparedQuery = {
  sql: string;
  types: string[];
  literals: string[];
  binds: string;
};

function preparedQuery(sql: string, names: string[], types: Record<string, string>, literals: Record<string, string>): PreparedQuery {
  const placed = toPlaceholders(sql, names);
  return {
    sql: placed.sql,
    types: placed.used.map((name) => {
      const type = types[name];
      if (!type) throw new Error(`No PostgreSQL type for ${name}`);
      return type;
    }),
    literals: placed.used.map((name) => {
      const literal = literals[name];
      if (!literal) throw new Error(`No literal for ${name}`);
      return literal;
    }),
    binds: placed.used.map((name) => `${name}=${literals[name]}`).join(", "),
  };
}

async function explainPrepared(
  client: pg.PoolClient,
  name: string,
  prepared: PreparedQuery,
  source: string,
  mode: "force_generic_plan" | "force_custom_plan",
  note: string
): Promise<PlanRecord> {
  const saved = writeSql(name, prepared.sql, source, `-- execute: ${prepared.binds}\n`);
  const planName = `${name}.${mode === "force_generic_plan" ? "generic" : "custom"}`;
  try {
    await client.query(`prepare bench_capture(${prepared.types.join(", ")}) as\n${prepared.sql}`);
    await client.query(`set plan_cache_mode = ${mode}`);
    const text = `explain (analyze, buffers, verbose, settings)\nexecute bench_capture(${prepared.literals.join(", ")})`;
    const planText = (result: pg.QueryResult) => result.rows.map((row) => String(Object.values(row)[0] ?? "")).join("\n");
    const first = await client.query(text);
    const pass1 = timings(planText(first)).executionMs;
    const second = await client.query(text);
    const plan = planText(second);
    const parsed = timings(plan);
    const planFile = path.join(outDir, `${planName}.plan.txt`);
    writeFileSync(planFile, `-- plan_cache_mode: ${mode}\n${plan}\n`);
    requireFile(planFile);
    return {
      id: planName,
      source,
      status: "ok",
      sqlFile: saved.file,
      planFile,
      sha256: saved.checksum,
      bytes: saved.bytes,
      planningMs: parsed.planningMs,
      executionMs: parsed.executionMs,
      pass1ExecutionMs: pass1,
      bufferCache: "warm",
      note,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: planName,
      source,
      status: "failed",
      sqlFile: saved.file,
      planFile: null,
      sha256: saved.checksum,
      bytes: saved.bytes,
      planningMs: null,
      executionMs: null,
      pass1ExecutionMs: null,
      bufferCache: "warm",
      note: message,
    };
  } finally {
    await client.query("deallocate bench_capture").catch(() => undefined);
    await client.query("set plan_cache_mode = auto").catch(() => undefined);
  }
}

async function main(): Promise<void> {
  discardGeminiCredentials();
  const databaseUrl = process.env.BENCH_DATABASE_URL;
  const decision = decideTarget({ databaseUrl, confirm: process.env.BENCH_CONFIRM });
  if (!decision.ok) throw new Error(decision.reason);
  mkdirSync(outDir, { recursive: true });

  const originalFile = path.join(root, "supabase/migrations/20261022010_exclude_deleted_reviews.sql");
  const insightFile = path.join(root, "supabase/migrations/20261022011_insight_dashboard.sql");
  const original = extractFunctionBody(readFileSync(originalFile, "utf8"), originalFile, "grm_dashboard_bundle");
  const insightSource = extractFunctionBody(readFileSync(insightFile, "utf8"), insightFile, "grm_insight_dashboard");
  if (original.language !== "sql") throw new Error("grm_dashboard_bundle in the migration is not language sql.");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const records: PlanRecord[] = [];
  try {
    const identity = await client.query("select inet_server_addr()::text as addr, version() as version");
    const addr = identity.rows[0].addr as string | null;
    if (!serverAddressAllowed(addr, decision.host)) {
      throw new Error(`Connected server address ${addr} does not match the confirmed host.`);
    }
    const installedDef = await client.query(
      "select pg_get_functiondef('public.grm_dashboard_bundle(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure) as def"
    );
    const installed = extractFunctionBody(String(installedDef.rows[0].def), "pg_get_functiondef(grm_dashboard_bundle)", "grm_dashboard_bundle");
    const settings = await client.query(
      `select name, setting, unit from pg_settings
       where name in ('server_version','shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather')
       order by name`
    );
    const counts = await client.query(
      `select
         (select count(*) from public.grm_reviews) as reviews,
         (select count(*) from bench.tenants where seed = 20261027) as tenants`
    );
    const tenants = await client.query(
      `select tenant_index, workspace_id::text, review_count::int as review_count, locations
       from bench.tenants where seed = 20261027
       order by review_count desc, tenant_index`
    );
    const rows = tenants.rows as Array<{
      tenant_index: number;
      workspace_id: string;
      review_count: number;
      locations: Array<{ id: string; groupId: string }>;
    }>;
    const picked = [
      { label: "largest", row: rows[0] },
      { label: "second", row: rows[1] },
      { label: "smallest", row: rows[rows.length - 1] },
    ];
    writeFileSync(
      path.join(outDir, "environment.json"),
      JSON.stringify(
        {
          database: redactDatabaseUrl(databaseUrl ?? ""),
          serverAddr: addr,
          version: identity.rows[0].version,
          settings: settings.rows,
          counts: counts.rows[0],
          bufferCache: "warm",
          bufferCacheNote: "This Postgres process already held the bench data in shared buffers. These plans are warm. A cold cache was not created.",
          tenants: picked.map((item) => ({
            label: item.label,
            tenantIndex: item.row.tenant_index,
            workspaceId: item.row.workspace_id,
            reviewCount: item.row.review_count,
            locationId: item.row.locations[0]?.id,
            groupId: item.row.locations[0]?.groupId,
            locationCount: item.row.locations.length,
          })),
        },
        null,
        2
      )
    );

    const wanted = ["dashboard.bundle_group_30d", "dashboard.bundle_all_time", "dashboard.insights_30d", "inbox.page_recent"];
    for (const item of picked) {
      const ctx: WorkloadContext = {
        workspaceId: item.row.workspace_id,
        otherWorkspaceId: rows[rows.length - 1].workspace_id,
        locationId: item.row.locations[0].id,
        groupId: item.row.locations[0].groupId,
        locationIds: item.row.locations.slice(0, 80).map((location) => location.id),
        cacheKey: `bench:20261027:${item.row.tenant_index}`,
        seed: 20261027,
        tenantIndex: item.row.tenant_index,
      };
      for (const id of wanted) {
        const workload = WORKLOADS.find((entry) => entry.id === id);
        if (!workload) throw new Error(`Benchmark workload ${id} is not defined.`);
        records.push(
          await explain(
            client,
            `${id}.${item.label}.benchmark`,
            workload.sql,
            bindWorkload(workload, ctx),
            "bench/workloads.ts",
            "Exact statement the benchmark sends. A function call does not inline its body into this plan."
          )
        );
      }

      const ranges = [
        { name: "30d", start: "now() - interval '30 days'", end: "now()" },
        { name: "all-time", start: "null::timestamptz", end: "null::timestamptz" },
      ];
      const bundleNames = ["p_workspace_id", "p_client_id", "p_group_id", "p_location_id", "p_start", "p_end", "p_timezone"];
      const bundleTypes = {
        p_workspace_id: "uuid",
        p_client_id: "uuid",
        p_group_id: "uuid",
        p_location_id: "uuid",
        p_start: "timestamptz",
        p_end: "timestamptz",
        p_timezone: "text",
      };
      for (const range of ranges) {
        const bundleLiterals = {
          p_workspace_id: uuidLiteral(ctx.workspaceId),
          p_client_id: "null::uuid",
          p_group_id: uuidLiteral(ctx.groupId),
          p_location_id: "null::uuid",
          p_start: range.start,
          p_end: range.end,
          p_timezone: "'UTC'",
        };
        if (range.name === "all-time") bundleLiterals.p_group_id = "null::uuid";
        for (const [kind, extracted, source] of [
          ["original", original, originalFile],
          ["installed", installed, "pg_get_functiondef(grm_dashboard_bundle)"],
        ] as const) {
          const prepared = preparedQuery(extracted.body, bundleNames, bundleTypes, bundleLiterals);
          for (const mode of ["force_generic_plan", "force_custom_plan"] as const) {
            records.push(
              await explainPrepared(
                client,
                `grm_dashboard_bundle.${kind}.${item.label}.${range.name}`,
                prepared,
                source,
                mode,
                kind === "original"
                  ? "Body from 20261022010. The SQL function caches a generic plan; that is the plan the benchmark function call runs. The custom plan is what the planner chooses once it sees these parameter values."
                  : "Body currently installed. The generic plan matches the benchmark function call. The custom plan folds the parameter values."
              )
            );
          }
        }
      }

      const insightNames = ["p_workspace_id", "p_location_ids", "p_start", "p_end", "p_analysis_version"];
      const insightTypes = {
        p_workspace_id: "uuid",
        p_location_ids: "uuid[]",
        p_start: "timestamptz",
        p_end: "timestamptz",
        p_analysis_version: "text",
      };
      const insightLiterals = {
        p_workspace_id: uuidLiteral(ctx.workspaceId),
        p_location_ids: `array[${ctx.locationIds.map((id) => uuidLiteral(id)).join(", ")}]::uuid[]`,
        p_start: "now() - interval '30 days'",
        p_end: "now()",
        p_analysis_version: "'obs-v1'",
      };
      const statements = splitSqlStatements(insightSource.body).filter(isExplainableQuery);
      if (statements.length < 10) {
        throw new Error(`${insightFile}: expected the counts query plus nine aggregates, found ${statements.length} explainable statements.`);
      }
      for (let index = 0; index < statements.length; index += 1) {
        const stripped = withoutSelectInto(statements[index]);
        if (!/\bp_workspace_id\b/.test(stripped.sql)) {
          throw new Error(`${insightFile}: statement ${index + 1} does not filter p_workspace_id.`);
        }
        const prepared = preparedQuery(stripped.sql, insightNames, insightTypes, insightLiterals);
        for (const mode of ["force_generic_plan", "force_custom_plan"] as const) {
          records.push(
            await explainPrepared(
              client,
              `grm_insight_dashboard.${item.label}.stmt${index + 1}`,
              prepared,
              insightFile,
              mode,
              stripped.removedInto
                ? `Statement ${index + 1} of grm_insight_dashboard. INTO ${stripped.removedInto} was removed so EXPLAIN does not create a table. ${mode} is recorded on the plan file.`
                : `Statement ${index + 1} of grm_insight_dashboard. ${mode} is recorded on the plan file.`
            )
          );
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  const failed = records.filter((record) => record.status !== "ok" || !record.planFile);
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ outDir, records, failed: failed.length }, null, 2));
  if (failed.length > 0) {
    process.stderr.write(`${failed.length} plan captures failed. See ${outDir}/manifest.json\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ outDir, plans: records.length, failed: 0 }, null, 2)}\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
