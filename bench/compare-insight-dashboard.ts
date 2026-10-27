import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { payloadsEqual } from "./compare-dashboard-bundle";
import { decideTarget, discardGeminiCredentials, redactDatabaseUrl, serverAddressAllowed } from "./safety";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateFile = path.join(root, "supabase/migrations/20261027004_insight_dashboard_window.sql");
const previousFile = path.join(root, "supabase/migrations/20261022011_insight_dashboard.sql");
const SEED = 20261027;

type Tenant = {
  label: string;
  workspaceId: string;
  reviewCount: number;
  locationId: string;
  locationIds: string[];
};

type CaseResult = { id: string; ok: boolean; detail: string };

const UNORDERED_KEYS = new Set(["positive", "negative", "byOutlet", "staffPraise", "staffComplaints", "severeIncidents"]);

function insightPayloadsEqual(baseline: unknown, candidate: unknown): { ok: boolean; detail: string } {
  if (!baseline || !candidate || typeof baseline !== "object" || typeof candidate !== "object") {
    return payloadsEqual(baseline, candidate);
  }
  const left = baseline as Record<string, unknown>;
  const right = candidate as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
  for (const key of keys) {
    if (!(key in left) || !(key in right)) return { ok: false, detail: `missing key ${key}` };
    if (key === "byMonth") {
      // months are ordered
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return { ok: false, detail: "byMonth mismatch" };
      continue;
    }
    if (key === "outletReviews") {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return { ok: false, detail: "outletReviews mismatch" };
      continue;
    }
    if (key === "counts") {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return { ok: false, detail: "counts mismatch" };
      continue;
    }
    if (UNORDERED_KEYS.has(key)) {
      const check = payloadsEqual({ [key]: left[key] }, { [key]: right[key] });
      // payloadsEqual only set-equals known dashboard keys; do manual set-eq here
      const a = left[key];
      const b = right[key];
      if (Array.isArray(a) && Array.isArray(b)) {
        const as = a.map((item) => JSON.stringify(item)).sort();
        const bs = b.map((item) => JSON.stringify(item)).sort();
        if (as.length !== bs.length || as.some((item, i) => item !== bs[i])) {
          return { ok: false, detail: `set mismatch on ${key}` };
        }
        continue;
      }
      if (JSON.stringify(a) !== JSON.stringify(b)) return { ok: false, detail: `mismatch on ${key}` };
      continue;
    }
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      return { ok: false, detail: `mismatch on ${key}` };
    }
  }
  return { ok: true, detail: "equal" };
}

function rewriteFunctionName(def: string, from: string, to: string): string {
  const create = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?/i.exec(def);
  if (!create || create.index === undefined) throw new Error(`Missing create function for ${from}`);
  const slice = def.slice(create.index);
  const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(slice);
  if (!opener || opener.index === undefined) throw new Error(`Missing AS tag for ${from}`);
  const tag = opener[1];
  const bodyStart = slice.indexOf(tag, opener.index) + tag.length;
  const closeAt = slice.indexOf(tag, bodyStart);
  if (closeAt < 0) throw new Error(`Missing closing tag for ${from}`);
  let end = closeAt + tag.length;
  const trailing = slice.slice(end).match(/^\s*;?/);
  if (trailing) end += trailing[0].length;
  const statement = `${slice.slice(0, end).trimEnd()};`;
  const pattern = new RegExp(`(create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?)${from}\\b`, "i");
  if (!pattern.test(statement)) throw new Error(`Could not rename ${from}`);
  return statement.replace(pattern, `$1${to}`);
}

async function callInsight(
  client: pg.PoolClient,
  fn: "grm_insight_dashboard" | "grm_insight_dashboard_baseline",
  workspaceId: string,
  locationIds: string[],
  start: Date | null,
  end: Date | null
): Promise<unknown> {
  const result = await client.query(
    `select public.${fn}($1::uuid, $2::uuid[], $3::timestamptz, $4::timestamptz, 'obs-v1') as payload`,
    [workspaceId, locationIds, start, end]
  );
  return result.rows[0].payload;
}

async function compareCase(
  client: pg.PoolClient,
  id: string,
  workspaceId: string,
  locationIds: string[],
  start: Date | null,
  end: Date | null
): Promise<CaseResult> {
  const baseline = await callInsight(client, "grm_insight_dashboard_baseline", workspaceId, locationIds, start, end);
  const candidate = await callInsight(client, "grm_insight_dashboard", workspaceId, locationIds, start, end);
  const check = insightPayloadsEqual(baseline, candidate);
  return { id, ok: check.ok, detail: check.detail };
}

async function loadTenants(client: pg.PoolClient): Promise<Tenant[]> {
  const result = await client.query(
    `select tenant_index, workspace_id::text as workspace_id, review_count::int as review_count, locations
     from bench.tenants where seed = $1
     order by review_count desc, tenant_index`,
    [SEED]
  );
  const rows = result.rows as Array<{
    workspace_id: string;
    review_count: number;
    locations: Array<{ id: string; groupId: string }>;
  }>;
  return [
    { label: "largest", row: rows[0] },
    { label: "second", row: rows[1] },
    { label: "smallest", row: rows[rows.length - 1] },
  ].map((item) => ({
    label: item.label,
    workspaceId: item.row.workspace_id,
    reviewCount: item.row.review_count,
    locationId: item.row.locations[0].id,
    locationIds: item.row.locations.map((location) => location.id),
  }));
}

async function main(): Promise<void> {
  discardGeminiCredentials();
  const databaseUrl = process.env.BENCH_DATABASE_URL;
  const decision = decideTarget({ databaseUrl, confirm: process.env.BENCH_CONFIRM });
  if (!decision.ok) throw new Error(decision.reason);
  const candidateSql = readFileSync(candidateFile, "utf8");
  if (!candidateSql.includes("coalesce(p_start, '-infinity'") || !candidateSql.includes("scoped_obs as materialized")) {
    throw new Error(`${candidateFile} is missing the expected date coalesce or scoped_obs CTE.`);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const results: CaseResult[] = [];
  try {
    const identity = await client.query("select inet_server_addr()::text as addr");
    if (!serverAddressAllowed(identity.rows[0].addr as string | null, decision.host)) {
      throw new Error(`Connected server address ${identity.rows[0].addr} does not match the confirmed host.`);
    }

    await client.query("begin");
    const installed = String(
      (
        await client.query(
          "select pg_get_functiondef('public.grm_insight_dashboard(uuid,uuid[],timestamptz,timestamptz,text)'::regprocedure) as def"
        )
      ).rows[0].def
    );
    const baselineSource = installed.includes("scoped_obs as materialized")
      ? readFileSync(previousFile, "utf8")
      : installed;
    await client.query(rewriteFunctionName(baselineSource, "grm_insight_dashboard", "grm_insight_dashboard_baseline"));
    await client.query(
      "revoke all on function public.grm_insight_dashboard_baseline(uuid, uuid[], timestamptz, timestamptz, text) from public, anon, authenticated"
    );
    await client.query(
      "grant execute on function public.grm_insight_dashboard_baseline(uuid, uuid[], timestamptz, timestamptz, text) to service_role"
    );
    await client.query(candidateSql);

    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const windows: Array<{ name: string; start: Date | null; end: Date | null }> = [
      { name: "30d", start: new Date(now.getTime() - 30 * day), end: now },
      { name: "180d", start: new Date(now.getTime() - 180 * day), end: now },
      { name: "prev_30d", start: new Date(now.getTime() - 60 * day), end: new Date(now.getTime() - 30 * day) },
      { name: "all_time", start: null, end: null },
    ];
    const tenants = await loadTenants(client);
    for (const tenant of tenants) {
      for (const window of windows) {
        results.push(
          await compareCase(
            client,
            `${tenant.label}.org.${window.name}`,
            tenant.workspaceId,
            tenant.locationIds,
            window.start,
            window.end
          )
        );
        results.push(
          await compareCase(
            client,
            `${tenant.label}.location.${window.name}`,
            tenant.workspaceId,
            [tenant.locationId],
            window.start,
            window.end
          )
        );
      }
      results.push(await compareCase(client, `${tenant.label}.empty_locations`, tenant.workspaceId, [], null, null));
    }

    const largest = tenants[0];
    const before = await callInsight(client, "grm_insight_dashboard_baseline", largest.workspaceId, largest.locationIds, null, null);
    const review = await client.query(
      `select id::text from public.grm_reviews
       where workspace_id = $1::uuid and missing_on_google_at is null
       order by review_create_time desc limit 1`,
      [largest.workspaceId]
    );
    await client.query(`update public.grm_reviews set missing_on_google_at = now() where id = $1::uuid`, [review.rows[0].id]);
    results.push(await compareCase(client, "largest.deleted_review.all_time", largest.workspaceId, largest.locationIds, null, null));
    const after = await callInsight(client, "grm_insight_dashboard", largest.workspaceId, largest.locationIds, null, null);
    const beforeDiscovered = Number((before as { counts: { discovered: number } }).counts.discovered);
    const afterDiscovered = Number((after as { counts: { discovered: number } }).counts.discovered);
    results.push({
      id: "largest.deleted_review.count_drops",
      ok: afterDiscovered === beforeDiscovered - 1,
      detail: `before=${beforeDiscovered} after=${afterDiscovered}`,
    });
    await client.query(`update public.grm_reviews set missing_on_google_at = null where id = $1::uuid`, [review.rows[0].id]);

    const member = await client.query(
      `select user_id::text as user_id from public.grm_workspace_members where workspace_id = $1::uuid limit 1`,
      [tenants[2].workspaceId]
    );
    const isolUser = member.rows[0].user_id as string;
    await client.query(`delete from public.grm_workspace_members where user_id = $1::uuid and workspace_id <> $2::uuid`, [
      isolUser,
      tenants[2].workspaceId,
    ]);
    await client.query(
      `update public.grm_workspace_members set active = true, access_enabled = true
       where workspace_id = $1::uuid and user_id = $2::uuid`,
      [tenants[2].workspaceId, isolUser]
    );
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [isolUser]);
    let denied = false;
    await client.query("savepoint isolation_execute");
    try {
      await client.query(`select public.grm_insight_dashboard($1::uuid, $2::uuid[], null, null, 'obs-v1')`, [
        tenants[0].workspaceId,
        tenants[0].locationIds,
      ]);
      await client.query("release savepoint isolation_execute");
    } catch (error) {
      denied = /permission denied|42501/i.test(error instanceof Error ? error.message : String(error));
      await client.query("rollback to savepoint isolation_execute");
    }
    const scoped = await client.query(
      `select
         count(*) filter (where workspace_id = $1::uuid)::int as own_rows,
         count(*) filter (where workspace_id = $2::uuid)::int as foreign_rows
       from public.grm_reviews`,
      [tenants[2].workspaceId, tenants[0].workspaceId]
    );
    await client.query("reset role");
    results.push({
      id: "isolation.execute_denied",
      ok: denied,
      detail: denied ? "permission denied" : "authenticated executed the RPC",
    });
    results.push({
      id: "isolation.review_scope",
      ok: Number(scoped.rows[0].foreign_rows) === 0 && Number(scoped.rows[0].own_rows) === tenants[2].reviewCount,
      detail: `own=${scoped.rows[0].own_rows} foreign=${scoped.rows[0].foreign_rows}`,
    });

    await client.query("rollback");
    const failed = results.filter((result) => !result.ok);
    process.stdout.write(
      `${JSON.stringify(
        {
          database: redactDatabaseUrl(databaseUrl ?? ""),
          candidate: candidateFile,
          rolledBack: true,
          passed: results.length - failed.length,
          failed: failed.length,
          results,
        },
        null,
        2
      )}\n`
    );
    if (failed.length > 0) process.exitCode = 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
