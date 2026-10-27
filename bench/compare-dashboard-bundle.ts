import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { decideTarget, discardGeminiCredentials, redactDatabaseUrl, serverAddressAllowed } from "./safety";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateFile =
  process.env.BENCH_BUNDLE_CANDIDATE ??
  path.join(root, "supabase/migrations/20261027005_dashboard_bundle_enable_sort_off.sql");
const previousFile =
  process.env.BENCH_BUNDLE_BASELINE ??
  path.join(root, "supabase/migrations/20261027003_dashboard_bundle_visible_locations.sql");
const SEED = 20261027;

type Tenant = {
  label: string;
  workspaceId: string;
  reviewCount: number;
  locationId: string;
  groupId: string;
  locationIds: string[];
};

type CaseResult = { id: string; ok: boolean; detail: string };

const UNORDERED_ARRAY_KEYS = new Set(["locations", "groups", "theme_groups", "theme_months", "team"]);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function setEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return stableStringify(a) === stableStringify(b);
  if (a.length !== b.length) return false;
  const left = a.map((item) => stableStringify(item)).sort();
  const right = b.map((item) => stableStringify(item)).sort();
  return left.every((item, index) => item === right[index]);
}

export function payloadsEqual(baseline: unknown, candidate: unknown): { ok: boolean; detail: string } {
  if (baseline === null || candidate === null || typeof baseline !== "object" || typeof candidate !== "object") {
    const same = stableStringify(baseline) === stableStringify(candidate);
    return { ok: same, detail: same ? "equal" : "scalar mismatch" };
  }
  const left = baseline as Record<string, unknown>;
  const right = candidate as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
  for (const key of keys) {
    if (!(key in left) || !(key in right)) {
      return { ok: false, detail: `missing key ${key}` };
    }
    if (UNORDERED_ARRAY_KEYS.has(key)) {
      if (!setEqual(left[key], right[key])) return { ok: false, detail: `set mismatch on ${key}` };
      continue;
    }
    if (stableStringify(left[key]) !== stableStringify(right[key])) {
      return { ok: false, detail: `value mismatch on ${key}` };
    }
  }
  return { ok: true, detail: "equal" };
}

function rewriteFunctionName(def: string, from: string, to: string): string {
  const create = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?/i.exec(def);
  if (!create || create.index === undefined) {
    throw new Error(`Could not find a create function statement while renaming ${from}.`);
  }
  const slice = def.slice(create.index);
  const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(slice);
  if (!opener || opener.index === undefined) {
    throw new Error(`Could not find the AS dollar-quote opener for ${from}.`);
  }
  const tag = opener[1];
  const bodyStart = slice.indexOf(tag, opener.index) + tag.length;
  const closeAt = slice.indexOf(tag, bodyStart);
  if (closeAt < 0) {
    throw new Error(`Could not find the closing dollar-quote for ${from}.`);
  }
  let end = closeAt + tag.length;
  const trailing = slice.slice(end).match(/^\s*;?/);
  if (trailing) end += trailing[0].length;
  const statement = `${slice.slice(0, end).trimEnd()};`;
  const pattern = new RegExp(`(create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?)${from}\\b`, "i");
  if (!pattern.test(statement)) throw new Error(`Could not rename ${from} to ${to} in function definition.`);
  return statement.replace(pattern, `$1${to}`);
}

async function callBundle(
  client: pg.PoolClient,
  fn: "grm_dashboard_bundle" | "grm_dashboard_bundle_baseline",
  workspaceId: string,
  clientId: string | null,
  groupId: string | null,
  locationId: string | null,
  start: Date | null,
  end: Date | null
): Promise<unknown> {
  const result = await client.query(
    `select public.${fn}($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::timestamptz, 'UTC') as payload`,
    [workspaceId, clientId, groupId, locationId, start, end]
  );
  return result.rows[0].payload;
}

async function compareCase(
  client: pg.PoolClient,
  id: string,
  workspaceId: string,
  clientId: string | null,
  groupId: string | null,
  locationId: string | null,
  start: Date | null,
  end: Date | null
): Promise<CaseResult> {
  const baseline = await callBundle(client, "grm_dashboard_bundle_baseline", workspaceId, clientId, groupId, locationId, start, end);
  const candidate = await callBundle(client, "grm_dashboard_bundle", workspaceId, clientId, groupId, locationId, start, end);
  const check = payloadsEqual(baseline, candidate);
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
  return picked.map((item) => ({
    label: item.label,
    workspaceId: item.row.workspace_id,
    reviewCount: item.row.review_count,
    locationId: item.row.locations[0].id,
    groupId: item.row.locations[0].groupId,
    locationIds: item.row.locations.map((location) => location.id),
  }));
}

async function main(): Promise<void> {
  discardGeminiCredentials();
  const databaseUrl = process.env.BENCH_DATABASE_URL;
  const decision = decideTarget({ databaseUrl, confirm: process.env.BENCH_CONFIRM });
  if (!decision.ok) throw new Error(decision.reason);

  const candidateSql = readFileSync(candidateFile, "utf8");
  if (!candidateSql.includes("visible_locations as materialized")) {
    throw new Error(`${candidateFile} does not contain the visible_locations MATERIALIZED CTE.`);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const results: CaseResult[] = [];
  try {
    const identity = await client.query("select inet_server_addr()::text as addr, version() as version");
    if (!serverAddressAllowed(identity.rows[0].addr as string | null, decision.host)) {
      throw new Error(`Connected server address ${identity.rows[0].addr} does not match the confirmed host.`);
    }

    await client.query("begin");
    const installed = await client.query(
      "select pg_get_functiondef('public.grm_dashboard_bundle(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure) as def"
    );
    const installedDef = String(installed.rows[0].def);
    // Prefer the live installed body when it is still the pre-fix definition.
    // After the candidate has been applied for real, fall back to 20261027002.
    const baselineSource = installedDef.includes("visible_locations as materialized")
      ? readFileSync(previousFile, "utf8")
      : installedDef;
    const baselineDef = rewriteFunctionName(baselineSource, "grm_dashboard_bundle", "grm_dashboard_bundle_baseline");
    await client.query(baselineDef);
    await client.query(
      "revoke all on function public.grm_dashboard_bundle_baseline(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated"
    );
    await client.query(
      "grant execute on function public.grm_dashboard_bundle_baseline(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) to service_role"
    );
    await client.query(candidateSql);

    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const start30 = new Date(now.getTime() - 30 * day);
    const start60 = new Date(now.getTime() - 60 * day);
    const tenants = await loadTenants(client);
    for (const tenant of tenants) {
      results.push(await compareCase(client, `${tenant.label}.all_time.org`, tenant.workspaceId, null, null, null, null, null));
      results.push(await compareCase(client, `${tenant.label}.all_time.group`, tenant.workspaceId, null, tenant.groupId, null, null, null));
      results.push(await compareCase(client, `${tenant.label}.all_time.location`, tenant.workspaceId, null, null, tenant.locationId, null, null));
      results.push(await compareCase(client, `${tenant.label}.30d.org`, tenant.workspaceId, null, null, null, start30, now));
      results.push(await compareCase(client, `${tenant.label}.prev_30d.org`, tenant.workspaceId, null, null, null, start60, start30));
    }

    // Empty location: create a scoped location with zero reviews for the largest tenant.
    const largest = tenants[0];
    const emptyLocation = await client.query(
      `insert into public.grm_google_locations (
         workspace_id, client_id, group_id, google_account_id, google_location_name, location_title
       )
       select $1::uuid, l.client_id, l.group_id, l.google_account_id,
              'accounts/bench/locations/empty-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
              'Bench empty location'
       from public.grm_google_locations l
       where l.id = $2::uuid
       returning id::text`,
      [largest.workspaceId, largest.locationId]
    );
    const emptyLocationId = emptyLocation.rows[0].id as string;
    results.push(
      await compareCase(client, "largest.empty_location.all_time", largest.workspaceId, null, null, emptyLocationId, null, null)
    );

    // Deleted review exclusion: mark one visible review as missing and compare.
    const review = await client.query(
      `select id::text
       from public.grm_reviews
       where workspace_id = $1::uuid and missing_on_google_at is null
       order by review_create_time desc
       limit 1`,
      [largest.workspaceId]
    );
    const reviewId = review.rows[0]?.id as string | undefined;
    if (!reviewId) throw new Error("Largest tenant has no visible reviews to mark deleted.");
    const before = await callBundle(client, "grm_dashboard_bundle_baseline", largest.workspaceId, null, null, null, null, null);
    await client.query(`update public.grm_reviews set missing_on_google_at = now() where id = $1::uuid`, [reviewId]);
    results.push(await compareCase(client, "largest.deleted_review.all_time", largest.workspaceId, null, null, null, null, null));
    const after = await callBundle(client, "grm_dashboard_bundle", largest.workspaceId, null, null, null, null, null);
    const beforeReviews = Number((before as { reviews: number }).reviews);
    const afterReviews = Number((after as { reviews: number }).reviews);
    results.push({
      id: "largest.deleted_review.count_drops",
      ok: afterReviews === beforeReviews - 1,
      detail: `baseline_before=${beforeReviews} candidate_after=${afterReviews}`,
    });
    await client.query(`update public.grm_reviews set missing_on_google_at = null where id = $1::uuid`, [reviewId]);

    // Unassigned-client exclusion: point one location at an unassigned client.
    const unassigned = await client.query(
      `insert into public.grm_clients (id, workspace_id, name, notes, is_active)
       values (gen_random_uuid(), $1::uuid, 'Bench Unassigned', 'grm:system:unassigned', true)
       returning id::text`,
      [largest.workspaceId]
    );
    const unassignedId = unassigned.rows[0].id as string;
    const originalClient = await client.query(
      `select client_id::text as client_id, group_id::text as group_id
       from public.grm_google_locations where id = $1::uuid`,
      [largest.locationId]
    );
    await client.query(
      `update public.grm_google_locations
       set client_id = $1::uuid, group_id = null
       where id = $2::uuid`,
      [unassignedId, largest.locationId]
    );
    results.push(await compareCase(client, "largest.unassigned_location.all_time", largest.workspaceId, null, null, null, null, null));
    const excluded = await callBundle(client, "grm_dashboard_bundle", largest.workspaceId, null, null, largest.locationId, null, null);
    results.push({
      id: "largest.unassigned_location.zero",
      ok: Number((excluded as { reviews: number }).reviews) === 0,
      detail: `reviews=${(excluded as { reviews: number }).reviews}`,
    });
    await client.query(
      `update public.grm_google_locations
       set client_id = $1::uuid, group_id = $2::uuid
       where id = $3::uuid`,
      [originalClient.rows[0].client_id, originalClient.rows[0].group_id, largest.locationId]
    );

    // Tenant isolation: authenticated may not execute the RPC; review RLS still scopes by membership.
    const member = await client.query(
      `select m.user_id::text as user_id
       from public.grm_workspace_members m
       where m.workspace_id = $1::uuid
       limit 1`,
      [tenants[2].workspaceId]
    );
    if (!member.rows[0]) throw new Error("Smallest tenant has no membership for the isolation check.");
    const isolUser = member.rows[0].user_id as string;
    // Bench seed reuses one user across every tenant. Keep only the small-tenant
    // membership for this check; the surrounding transaction rolls that back.
    await client.query(`delete from public.grm_workspace_members where user_id = $1::uuid and workspace_id <> $2::uuid`, [
      isolUser,
      tenants[2].workspaceId,
    ]);
    await client.query(
      `update public.grm_workspace_members
       set active = true, access_enabled = true
       where workspace_id = $1::uuid and user_id = $2::uuid`,
      [tenants[2].workspaceId, isolUser]
    );
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [isolUser]);
    let denied = false;
    await client.query("savepoint isolation_execute");
    try {
      await client.query(`select public.grm_dashboard_bundle($1::uuid, null, null, null, null, null, 'UTC')`, [
        tenants[0].workspaceId,
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
