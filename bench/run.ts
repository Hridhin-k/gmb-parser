import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildPlan, planSummary, reviewBatches, type AnalysesMode, type BenchPlan } from "./dataset";
import {
  canAdvance,
  shouldStop,
  summarize,
  verdictFor,
  STATEMENT_TIMEOUT_MS,
  type LatencySample,
  type TargetVerdict,
} from "./metrics";
import {
  assertSeedHasNoModelCall,
  decideTarget,
  serverAddressAllowed,
  discardGeminiCredentials,
  fullAnalysisOnLargeAllowed,
  largeVolumeAllowed,
  redactDatabaseUrl,
  type SafetyEnv,
} from "./safety";
import { bindWorkload, WORKLOADS, type Workload, type WorkloadContext } from "./workloads";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export type StageName = "smoke" | "gradual" | "sustained" | "burst" | "mixed" | "recovery" | "all";

export type BenchOptions = {
  help: boolean;
  check: boolean;
  plan: boolean;
  seed: boolean;
  cleanup: boolean;
  stage: StageName | null;
  tenants: number;
  reviews: number;
  seedKey: number;
  analyses: AnalysesMode | null;
  explain: boolean;
};

const HELP = `RevuPilot bench

  npm run bench -- --plan --tenants 100 --reviews 100000
  npm run bench -- --check
  BENCH_DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres BENCH_CONFIRM=local npm run bench -- --seed --stage smoke --tenants 100 --reviews 100000

Staging (project yrmlbimuupirmttngxys only — never production):
  BENCH_DATABASE_URL=postgres://…@db.yrmlbimuupirmttngxys.supabase.co:6543/postgres \\
  BENCH_CONFIRM=staging \\
  BENCH_STAGING_HOST=db.yrmlbimuupirmttngxys.supabase.co \\
  npm run bench -- --seed --tenants 100 --reviews 100000
  # cleanup synthetic rows for this seed key:
  BENCH_CONFIRM=staging BENCH_STAGING_HOST=… BENCH_DATABASE_URL=… npm run bench -- --cleanup --seed-key 20261027

The suite reads only BENCH_DATABASE_URL. It refuses the production project, Google, and Gemini.
Hosted Supabase is refused unless BENCH_CONFIRM=staging, BENCH_STAGING_HOST matches exactly, and the URL contains the staging project ref.
Sessions use application_name revupilot-bench. Cancel them with:
  select pg_cancel_backend(pid) from pg_stat_activity where application_name like 'revupilot-bench%';

Stages stay at or below 50 users. A step stops after three timeouts or a 5% error rate.
10 million and 50 million reviews also need BENCH_ALLOW_LARGE=1.
`;

export function parseArgs(argv: string[]): BenchOptions {
  const options: BenchOptions = {
    help: false,
    check: false,
    plan: false,
    seed: false,
    cleanup: false,
    stage: null,
    tenants: 100,
    reviews: 100_000,
    seedKey: 20261027,
    analyses: null,
    explain: process.env.BENCH_EXPLAIN === "1",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--plan") options.plan = true;
    else if (arg === "--seed") options.seed = true;
    else if (arg === "--cleanup") options.cleanup = true;
    else if (arg === "--explain") options.explain = true;
    else if (arg === "--stage" && next) {
      options.stage = next as StageName;
      i += 1;
    } else if (arg === "--tenants" && next) {
      options.tenants = Number(next);
      i += 1;
    } else if (arg === "--reviews" && next) {
      options.reviews = Number(next);
      i += 1;
    } else if (arg === "--seed-key" && next) {
      options.seedKey = Number(next);
      i += 1;
    } else if (arg === "--analyses" && next) {
      options.analyses = next as AnalysesMode;
      i += 1;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return options;
}

function safetyEnv(): SafetyEnv {
  return {
    databaseUrl: process.env.BENCH_DATABASE_URL,
    confirm: process.env.BENCH_CONFIRM,
    stagingHost: process.env.BENCH_STAGING_HOST,
    allowLarge: process.env.BENCH_ALLOW_LARGE,
  };
}

type StageStep = {
  concurrency: number;
  iterations: number;
  durationMs: number | null;
  workloads: Workload[];
  writeEvery: number;
};

function stepsFor(stage: StageName): StageStep[] {
  const reads = WORKLOADS.filter((workload) => workload.kind === "read");
  const writes = WORKLOADS.filter((workload) => workload.kind === "write");
  const recovery = WORKLOADS.filter((workload) => workload.kind === "recovery");
  if (stage === "smoke") return [{ concurrency: 1, iterations: 3, durationMs: null, workloads: reads, writeEvery: 0 }];
  if (stage === "gradual") {
    return [1, 5, 10, 25, 50].map((concurrency) => ({
      concurrency,
      iterations: 8,
      durationMs: null,
      workloads: reads,
      writeEvery: 0,
    }));
  }
  if (stage === "sustained") {
    return [{ concurrency: 10, iterations: 10_000, durationMs: 30_000, workloads: reads, writeEvery: 0 }];
  }
  if (stage === "burst") {
    return [{ concurrency: 25, iterations: 15, durationMs: null, workloads: reads, writeEvery: 0 }];
  }
  if (stage === "mixed") {
    return [{ concurrency: 10, iterations: 10, durationMs: null, workloads: [...reads, ...writes], writeEvery: 5 }];
  }
  if (stage === "recovery") {
    return [{ concurrency: 1, iterations: 1, durationMs: null, workloads: recovery, writeEvery: 0 }];
  }
  throw new Error(`Unknown stage ${stage}`);
}

async function timedQuery(
  client: pg.PoolClient,
  workload: Workload,
  ctx: WorkloadContext,
  cold: boolean
): Promise<LatencySample> {
  const started = process.hrtime.bigint();
  const rollback = workload.id === "insight.invalidate_rollback";
  try {
    if (rollback) await client.query("begin");
    const result = await client.query(workload.sql, bindWorkload(workload, ctx));
    const row = result.rows[0] as { foreign_rows?: number | string; payload?: unknown } | undefined;
    if (rollback) await client.query("rollback");
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const foreign = Number(row?.foreign_rows ?? 0);
    const payload = row?.payload;
    const duplicateExtra =
      payload && typeof payload === "object" && "duplicate_extra" in payload
        ? Number((payload as { duplicate_extra: number }).duplicate_extra)
        : 0;
    const stuck =
      payload && typeof payload === "object" && "stuck" in payload
        ? Boolean((payload as { stuck: boolean }).stuck)
        : false;
    const ok = foreign === 0 && duplicateExtra === 0 && !stuck;
    return {
      workload: workload.id,
      ms,
      ok,
      cold,
      timedOut: false,
      bytes: Buffer.byteLength(JSON.stringify(payload ?? null)),
    };
  } catch (error) {
    if (rollback) await client.query("rollback").catch(() => undefined);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const message = error instanceof Error ? error.message : String(error);
    return {
      workload: workload.id,
      ms,
      ok: false,
      cold,
      timedOut: message.includes("statement timeout") || message.includes("canceling statement"),
      bytes: 0,
    };
  }
}

async function runStep(
  pool: pg.Pool,
  step: StageStep,
  contexts: WorkloadContext[]
): Promise<{ samples: LatencySample[]; stopped: string | null; elapsedMs: number }> {
  const started = Date.now();
  const samples: LatencySample[] = [];
  let stopped: string | null = null;
  const users = Array.from({ length: step.concurrency }, (_, index) => index);
  await Promise.all(
    users.map(async (user) => {
      const client = await pool.connect();
      try {
        await elevateStagingLoginRole(client);
        let iteration = 0;
        const seen = new Set<string>();
        while (iteration < step.iterations && !stopped) {
          if (step.durationMs !== null && Date.now() - started >= step.durationMs) break;
          for (const workload of step.workloads) {
            if (stopped) break;
            if (step.writeEvery > 0 && workload.kind === "write" && iteration % step.writeEvery !== 0) continue;
            if (step.writeEvery > 0 && workload.kind === "read" && iteration % step.writeEvery === 0) continue;
            const ctx = contexts[(user + iteration) % contexts.length];
            const cold = !seen.has(workload.id);
            seen.add(workload.id);
            samples.push(await timedQuery(client, workload, ctx, cold));
            const summary = summarize(samples, Date.now() - started);
            stopped = shouldStop(summary);
          }
          iteration += 1;
        }
      } finally {
        client.release();
      }
    })
  );
  return { samples, stopped, elapsedMs: Date.now() - started };
}

async function databasePressure(client: pg.PoolClient): Promise<Record<string, number | null>> {
  const stats = await client.query(
    `select numbackends, blks_hit, blks_read, xact_commit, tup_returned, tup_fetched
     from pg_stat_database where datname = current_database()`
  );
  const backends = await client.query(
    `select count(*)::int as bench_backends
     from pg_stat_activity where application_name like 'revupilot-bench%'`
  );
  const row = stats.rows[0] as Record<string, string>;
  return {
    backends: Number(row.numbackends),
    blksHit: Number(row.blks_hit),
    blksRead: Number(row.blks_read),
    xactCommit: Number(row.xact_commit),
    tupReturned: Number(row.tup_returned),
    tupFetched: Number(row.tup_fetched),
    benchBackends: Number(backends.rows[0].bench_backends),
    cpuPercent: null,
    memoryBytes: null,
  };
}

async function loadContexts(client: pg.PoolClient, plan: BenchPlan): Promise<WorkloadContext[]> {
  const result = await client.query(
    `select tenant_index, workspace_id, review_count, locations
     from bench.tenants where seed = $1 order by review_count desc, tenant_index`,
    [plan.seed]
  );
  if (result.rows.length === 0) {
    throw new Error("No bench tenants for this seed. Run --seed against the dedicated database first.");
  }
  const rows = result.rows as Array<{
    tenant_index: number;
    workspace_id: string;
    review_count: string;
    locations: Array<{ id: string; groupId: string }>;
  }>;
  const other = rows[rows.length - 1];
  return rows.slice(0, 2).map((row) => ({
    workspaceId: row.workspace_id,
    otherWorkspaceId: other.workspace_id,
    locationId: row.locations[0]?.id,
    groupId: row.locations[0]?.groupId,
    locationIds: row.locations.slice(0, 80).map((location) => location.id),
    cacheKey: `bench:${plan.seed}:${row.tenant_index}`,
    seed: plan.seed,
    tenantIndex: row.tenant_index,
  }));
}

function connectionUrl(timeoutMs: number): string {
  const url = process.env.BENCH_DATABASE_URL;
  if (!url) throw new Error("BENCH_DATABASE_URL is not set");
  const parsed = new URL(url);
  const existing = parsed.searchParams.get("options") ?? "";
  parsed.searchParams.set(
    "options",
    `${existing} -c statement_timeout=${timeoutMs} -c application_name=revupilot-bench`.trim()
  );
  return parsed.toString();
}

/** Hosted staging login-role can SET ROLE postgres but starts without table grants. */
async function elevateStagingLoginRole(client: pg.PoolClient): Promise<void> {
  if (process.env.BENCH_CONFIRM !== "staging") return;
  const who = await client.query("select current_user as u");
  if (who.rows[0]?.u === "cli_login_postgres") {
    await client.query("set role postgres");
  }
}

function stagingPoolMax(): number {
  // Free/nano staging advertises max_connections=60; leave headroom for the app and autovacuum.
  return process.env.BENCH_CONFIRM === "staging" ? 20 : 50;
}

function stepsForStaging(stage: StageName): StageStep[] {
  const steps = stepsFor(stage);
  if (process.env.BENCH_CONFIRM !== "staging") return steps;
  // Cap concurrency so pool + app stay under max_connections.
  return steps
    .map((step) => ({ ...step, concurrency: Math.min(step.concurrency, 20) }))
    .filter((step, index, all) => all.findIndex((other) => other.concurrency === step.concurrency) === index);
}

async function withPool<T>(timeoutMs: number, body: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({
    connectionString: connectionUrl(timeoutMs),
    max: stagingPoolMax(),
  });
  try {
    const client = await pool.connect();
    try {
      await elevateStagingLoginRole(client);
      const identity = await client.query("select inet_server_addr()::text as addr, current_database() as db");
      const addr = identity.rows[0].addr as string | null;
      const env = safetyEnv();
      const decision = decideTarget(env);
      // Hosted staging resolves to cloud IPs that will not equal the hostname.
      // decideTarget already required BENCH_CONFIRM=staging + exact host + staging ref.
      if (env.confirm !== "staging" && !serverAddressAllowed(addr, decision.host)) {
        throw new Error(`Connected server address ${addr} does not match the confirmed host.`);
      }
    } finally {
      client.release();
    }
    return await body(pool);
  } finally {
    await pool.end();
  }
}

function writeReport(report: unknown): string {
  const dir = path.join(root, "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

async function main(): Promise<void> {
  discardGeminiCredentials();
  const options = parseArgs(process.argv.slice(2));
  if (options.help || process.argv.slice(2).length === 0) {
    process.stdout.write(HELP);
    return;
  }
  const plan = buildPlan({
    seed: options.seedKey,
    tenants: options.tenants,
    reviews: options.reviews,
    analyses: options.analyses ?? undefined,
  });
  const summary = planSummary(plan);
  if (options.plan) {
    process.stdout.write(
      `${JSON.stringify({ summary, deviations: plan.deviations, estimates: plan.estimates, batches: reviewBatches(plan).length }, null, 2)}\n`
    );
    return;
  }

  const env = safetyEnv();
  const decision = decideTarget(env);
  const blockers = [
    decision.ok ? null : decision.reason,
    largeVolumeAllowed(plan.reviews, plan.analyses, env),
    fullAnalysisOnLargeAllowed(plan.reviews, plan.analyses, env),
  ].filter((item): item is string => Boolean(item));

  if (options.check) {
    process.stdout.write(
      `${JSON.stringify(
        {
          decision,
          blockers,
          databaseUrl: env.databaseUrl ? redactDatabaseUrl(env.databaseUrl) : null,
          measured: false,
          note: "Check does not open a connection and does not report latency.",
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (!options.seed && !options.stage && !options.cleanup) {
    throw new Error("Pass --plan, --check, --seed, --stage, or --cleanup.");
  }
  if (blockers.length > 0) {
    process.stdout.write(`${JSON.stringify({ measured: false, blockers, decision }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const sql = readFileSync(path.join(root, "sql", "install.sql"), "utf8");
  assertSeedHasNoModelCall(sql);
  await withPool(options.seed ? 120_000 : STATEMENT_TIMEOUT_MS, async (pool) => {
    const client = await pool.connect();
    try {
      await elevateStagingLoginRole(client);
      await client.query(sql);
      if (options.cleanup) {
        if (env.confirm !== "local" && env.confirm !== "staging") {
          throw new Error("Cleanup requires BENCH_CONFIRM=local or BENCH_CONFIRM=staging.");
        }
        const deleted = await client.query("select bench.cleanup_seed($1)::int as deleted", [plan.seed]);
        process.stdout.write(`${JSON.stringify({ cleanedWorkspaces: deleted.rows[0].deleted, seed: plan.seed })}\n`);
        return;
      }
      if (options.seed) {
        await client.query("select bench.seed_catalog($1::jsonb)", [JSON.stringify(plan)]);
        const progress = await client.query("select next_review from bench.runs where seed = $1", [plan.seed]);
        const completed = Number(progress.rows[0]?.next_review ?? 0);
        const batches = reviewBatches(plan, completed);
        for (const batch of batches) {
          const inserted = await client.query("select bench.insert_review_batch($1,$2,$3,$4)::int as inserted", [
            plan.seed,
            batch.tenantIndex,
            batch.from,
            batch.to,
          ]);
          process.stderr.write(
            `seed tenant ${batch.tenantIndex} ${batch.from}-${batch.to} inserted ${inserted.rows[0].inserted}\n`
          );
        }
      }
      if (!options.stage) return;

      const contexts = await loadContexts(client, plan);
      const before = await databasePressure(client);
      const stages = options.stage === "all" ? (["smoke", "gradual", "sustained", "burst", "mixed", "recovery"] as StageName[]) : [options.stage];
      const results: unknown[] = [];
      let firstBottleneck: string | null = null;
      let advance = true;
      for (const stage of stages) {
        if (!advance && stage !== "recovery" && stage !== "smoke") {
          results.push({ stage, skipped: "Previous step missed the advance gate." });
          continue;
        }
        for (const step of stepsForStaging(stage)) {
          if (!advance && step.concurrency > 1) {
            results.push({ stage, concurrency: step.concurrency, skipped: "Advance gate closed." });
            continue;
          }
          const run = await runStep(pool, step, contexts);
          const byWorkload = new Map<string, LatencySample[]>();
          for (const sample of run.samples) {
            const list = byWorkload.get(sample.workload) ?? [];
            list.push(sample);
            byWorkload.set(sample.workload, list);
          }
          const verdicts: TargetVerdict[] = [];
          for (const [workloadId, samples] of byWorkload) {
            const workload = WORKLOADS.find((item) => item.id === workloadId);
            if (!workload) continue;
            const cold = samples.find((sample) => sample.cold);
            const warmSamples = samples.filter((sample) => !sample.cold);
            const verdict = verdictFor({
              workload: workloadId,
              group: workload.group,
              warm: summarize(warmSamples.length > 0 ? warmSamples : samples, run.elapsedMs),
              coldMs: cold ? cold.ms : null,
            });
            verdicts.push(verdict);
            if (!verdict.passed && !firstBottleneck && workload.group !== "probe" && workload.group !== "write") {
              firstBottleneck = `${workloadId}: ${verdict.reason}`;
            }
          }
          const overall = summarize(run.samples, run.elapsedMs);
          if (run.stopped && !firstBottleneck) firstBottleneck = run.stopped;
          if (!canAdvance(overall)) advance = false;
          results.push({
            stage,
            concurrency: step.concurrency,
            elapsedMs: run.elapsedMs,
            stopped: run.stopped,
            overall,
            verdicts,
          });
        }
      }
      const after = await databasePressure(client);
      const hitDelta = after.blksHit! - before.blksHit!;
      const readDelta = after.blksRead! - before.blksRead!;
      const report = {
        measured: true,
        environment: {
          database: redactDatabaseUrl(env.databaseUrl ?? ""),
          host: decision.host,
          applicationName: "revupilot-bench",
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
          cpuPercent: null,
          memoryBytes: null,
          note: "CPU and memory are not visible from SQL. Block hits are database-wide during the run, not per query.",
        },
        dataset: { summary, estimates: plan.estimates, deviations: plan.deviations },
        cache: {
          blksHit: hitDelta,
          blksRead: readDelta,
          hitRate: hitDelta + readDelta === 0 ? null : hitDelta / (hitDelta + readDelta),
        },
        connections: { before: before.benchBackends, after: after.benchBackends },
        explain: options.explain
          ? "BENCH_EXPLAIN was set. EXPLAIN ANALYZE is still not executed by this runner, so a plan cannot replace the latency figures. Rows scanned, CPU, and memory are unmeasured."
          : "EXPLAIN ANALYZE was not run. Reported latency is the client round trip. Block hits sit beside that latency. Rows scanned, CPU, and memory are unmeasured.",
        firstBottleneck,
        results,
      };
      const file = writeReport(report);
      process.stdout.write(`${JSON.stringify({ reportFile: file, firstBottleneck, measured: true }, null, 2)}\n`);
    } finally {
      client.release();
    }
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
