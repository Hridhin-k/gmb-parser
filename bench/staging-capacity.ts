import pg from "pg";
import { decideTarget, redactDatabaseUrl } from "./safety";

async function main() {
  const env = {
    databaseUrl: process.env.BENCH_DATABASE_URL,
    confirm: process.env.BENCH_CONFIRM,
    stagingHost: process.env.BENCH_STAGING_HOST,
  };
  const decision = decideTarget(env);
  console.log("safety", decision);
  if (!decision.ok) process.exit(1);
  console.log("redacted", redactDatabaseUrl(env.databaseUrl!));

  const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 2, statement_timeout: 120_000 });
  const c = await pool.connect();
  try {
    await c.query("set application_name = 'revupilot-bench-capacity'");
    if (env.confirm === "staging") {
      const who = await c.query("select current_user as u");
      if (who.rows[0]?.u === "cli_login_postgres") await c.query("set role postgres");
    }
    const identity = await c.query(`
      select current_database() as db,
             current_user as usr,
             inet_server_addr()::text as addr,
             version() as ver
    `);
    console.log("identity", {
      db: identity.rows[0].db,
      usr: identity.rows[0].usr,
      addr: identity.rows[0].addr,
      ver: String(identity.rows[0].ver).slice(0, 60),
    });

    const sizes = await c.query(`
      select
        pg_size_pretty(pg_database_size(current_database())) as db_size,
        pg_database_size(current_database())::bigint as db_bytes,
        (select pg_size_pretty(pg_total_relation_size('public.grm_reviews'))) as reviews_total,
        (select pg_total_relation_size('public.grm_reviews')::bigint) as reviews_bytes,
        (select count(*)::bigint from public.grm_workspaces where slug like 'bench-%') as bench_workspaces,
        (select count(*)::bigint from public.grm_reviews) as review_rows,
        (select count(*)::bigint from public.grm_google_locations) as locations,
        (select coalesce(max(cnt),0) from (
           select count(*) as cnt from public.grm_reviews r
           join public.grm_google_locations l on l.id = r.location_id
           join public.grm_workspaces w on w.id = l.workspace_id
           where w.slug like 'bench-%'
           group by w.id
        ) t) as max_tenant_reviews
    `);
    console.log("capacity", sizes.rows[0]);

    const settings = await c.query(`
      select name, setting from pg_settings
      where name in ('max_connections','shared_buffers','work_mem','effective_cache_size','maintenance_work_mem')
      order by name
    `);
    console.log("settings", Object.fromEntries(settings.rows.map((r) => [r.name, r.setting])));

    const activity = await c.query(`
      select count(*)::int as total,
             count(*) filter (where state = 'active')::int as active,
             count(*) filter (where application_name like 'revupilot-bench%')::int as bench
      from pg_stat_activity
    `);
    console.log("activity", activity.rows[0]);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
