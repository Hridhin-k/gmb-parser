export const BLOCKED_WORKLOAD_HOSTS = [
  "googleapis.com",
  "generativelanguage.googleapis.com",
  "gemini",
  "supabase.co",
] as const;

export type WorkloadGroup = "dashboard" | "inbox" | "critical" | "probe" | "write";

export type Workload = {
  id: string;
  group: WorkloadGroup;
  /** Reads are the steady-state mix. Writes and drills run in their own stages. */
  kind: "read" | "write" | "recovery";
  sql: string;
};

const foreignRows = `
  (select count(*) from page where workspace_id <> $1::uuid) as foreign_rows
`;

export const WORKLOADS: Workload[] = [
  {
    id: "dashboard.bundle_30d",
    group: "dashboard",
    kind: "read",
    sql: `select public.grm_dashboard_bundle($1::uuid, null, null, null, now() - interval '30 days', now(), 'UTC') as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.bundle_location_30d",
    group: "dashboard",
    kind: "read",
    sql: `select public.grm_dashboard_bundle($1::uuid, null, null, $2::uuid, now() - interval '30 days', now(), 'UTC') as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.bundle_group_30d",
    group: "dashboard",
    kind: "read",
    sql: `select public.grm_dashboard_bundle($1::uuid, null, $2::uuid, null, now() - interval '30 days', now(), 'UTC') as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.bundle_all_time",
    group: "probe",
    kind: "read",
    sql: `select public.grm_dashboard_bundle($1::uuid, null, null, null, null, null, 'UTC') as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.stars_30d",
    group: "dashboard",
    kind: "read",
    sql: `select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) as payload, 0::bigint as foreign_rows
          from public.grm_star_breakdown($1::uuid, $2::uuid[], now() - interval '30 days', now(), 'UTC') s`,
  },
  {
    id: "dashboard.location_counts_30d",
    group: "dashboard",
    kind: "read",
    sql: `select coalesce(jsonb_agg(to_jsonb(s) order by s.review_count desc), '[]'::jsonb) as payload, 0::bigint as foreign_rows
          from public.grm_location_review_counts($1::uuid, now() - interval '30 days', now()) s`,
  },
  {
    id: "dashboard.analytics_30d",
    group: "dashboard",
    kind: "read",
    sql: `select public.grm_analytics_slice($1::uuid, $2::uuid[], now() - interval '30 days', now(), null) as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.insights_30d",
    group: "dashboard",
    kind: "read",
    sql: `select public.grm_insight_dashboard($1::uuid, $2::uuid[], now() - interval '30 days', now(), 'obs-v1') as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "dashboard.insight_report",
    group: "dashboard",
    kind: "read",
    sql: `select insights as payload, 0::bigint as foreign_rows
          from public.grm_insight_reports
          where workspace_id = $1::uuid and cache_key = $2::text`,
  },
  {
    id: "inbox.page_recent",
    group: "inbox",
    kind: "read",
    sql: `with page as (
            select id, workspace_id, star_rating, left(comment, 200) as comment, reply_status, review_create_time
            from public.grm_reviews
            where workspace_id = $1::uuid and missing_on_google_at is null
            order by review_create_time desc
            limit 30
          ), counted as (
            select count(*) as total
            from public.grm_reviews
            where workspace_id = $1::uuid and missing_on_google_at is null
          )
          select (select total from counted) as total, coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.page_unanswered_30d",
    group: "inbox",
    kind: "read",
    sql: `with page as (
            select id, workspace_id, star_rating, reply_status, review_create_time
            from public.grm_reviews
            where workspace_id = $1::uuid
              and missing_on_google_at is null
              and reply_status = 'none'
              and review_create_time >= now() - interval '30 days'
              and review_create_time < now()
            order by review_create_time desc
            limit 30
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.page_low_rating",
    group: "inbox",
    kind: "read",
    sql: `with page as (
            select id, workspace_id, star_rating, review_create_time
            from public.grm_reviews
            where workspace_id = $1::uuid
              and missing_on_google_at is null
              and star_rating <= 2
            order by star_rating asc, review_create_time desc
            limit 30
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.search_queue",
    group: "inbox",
    kind: "read",
    sql: `with page as (
            select id, workspace_id, left(comment, 200) as comment
            from public.grm_reviews
            where workspace_id = $1::uuid
              and missing_on_google_at is null
              and comment ilike '%queue%'
            order by review_create_time desc
            limit 30
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.page_offset_300",
    group: "probe",
    kind: "read",
    sql: `with page as (
            select id, workspace_id
            from public.grm_reviews
            where workspace_id = $1::uuid and missing_on_google_at is null
            order by review_create_time desc
            offset 300
            limit 30
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.open_review",
    group: "critical",
    kind: "read",
    sql: `with page as (
            select id, workspace_id, comment, star_rating, reply_status, review_create_time
            from public.grm_reviews
            where workspace_id = $1::uuid
              and google_review_name like 'bench/%'
              and missing_on_google_at is null
            order by review_create_time desc
            limit 1
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "inbox.replies",
    group: "critical",
    kind: "read",
    sql: `with opened as (
            select id
            from public.grm_reviews
            where workspace_id = $1::uuid and google_review_name like 'bench/%'
            order by review_create_time desc
            limit 1
          ),
          page as (
            select r.id, r.review_id, r.workspace_id, r.content, r.source, r.status, r.created_at
            from public.grm_review_replies r
            join opened on opened.id = r.review_id
            where r.workspace_id = $1::uuid
            order by r.created_at desc
          )
          select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) as payload, ${foreignRows}
          from page`,
  },
  {
    id: "isolation.other_tenant",
    group: "critical",
    kind: "read",
    sql: `select count(*) as payload, count(*) as foreign_rows
          from public.grm_reviews
          where workspace_id = $1::uuid
            and id in (select id from public.grm_reviews where workspace_id = $2::uuid limit 5)`,
  },
  {
    id: "sync.upsert_batch",
    group: "write",
    kind: "write",
    sql: `select bench.upsert_batch($1::uuid, $2::uuid, $3::integer, $4::integer) as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "jobs.fail_stale",
    group: "write",
    kind: "recovery",
    sql: `select bench.drill_fail_stale($1::uuid) as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "jobs.claim_quiet",
    group: "write",
    kind: "recovery",
    sql: `select bench.drill_claim($1::uuid) as payload, 0::bigint as foreign_rows`,
  },
  {
    id: "insight.invalidate_rollback",
    group: "write",
    kind: "recovery",
    sql: `select bench.drill_invalidate($1::uuid) as payload, 0::bigint as foreign_rows`,
  },
];

export function assertWorkloadsStayInside(workloads: Workload[] = WORKLOADS): void {
  for (const workload of workloads) {
    const sql = workload.sql.toLowerCase();
    for (const host of BLOCKED_WORKLOAD_HOSTS) {
      if (sql.includes(host)) {
        throw new Error(`${workload.id} references ${host}`);
      }
    }
    if (!sql.includes("$1")) {
      throw new Error(`${workload.id} has no workspace parameter`);
    }
  }
}

export function readWorkloads(): Workload[] {
  return WORKLOADS.filter((workload) => workload.kind === "read");
}

export function writeWorkloads(): Workload[] {
  return WORKLOADS.filter((workload) => workload.kind === "write");
}

export function recoveryWorkloads(): Workload[] {
  return WORKLOADS.filter((workload) => workload.kind === "recovery");
}

export type WorkloadContext = {
  workspaceId: string;
  otherWorkspaceId: string;
  locationId: string;
  groupId: string;
  locationIds: string[];
  cacheKey: string;
  seed: number;
  tenantIndex: number;
};

const BINDS: Record<string, (ctx: WorkloadContext) => unknown[]> = {
  "dashboard.bundle_30d": (ctx) => [ctx.workspaceId],
  "dashboard.bundle_location_30d": (ctx) => [ctx.workspaceId, ctx.locationId],
  "dashboard.bundle_group_30d": (ctx) => [ctx.workspaceId, ctx.groupId],
  "dashboard.bundle_all_time": (ctx) => [ctx.workspaceId],
  "dashboard.stars_30d": (ctx) => [ctx.workspaceId, ctx.locationIds],
  "dashboard.location_counts_30d": (ctx) => [ctx.workspaceId],
  "dashboard.analytics_30d": (ctx) => [ctx.workspaceId, ctx.locationIds],
  "dashboard.insights_30d": (ctx) => [ctx.workspaceId, ctx.locationIds],
  "dashboard.insight_report": (ctx) => [ctx.workspaceId, ctx.cacheKey],
  "inbox.page_recent": (ctx) => [ctx.workspaceId],
  "inbox.page_unanswered_30d": (ctx) => [ctx.workspaceId],
  "inbox.page_low_rating": (ctx) => [ctx.workspaceId],
  "inbox.search_queue": (ctx) => [ctx.workspaceId],
  "inbox.page_offset_300": (ctx) => [ctx.workspaceId],
  "inbox.open_review": (ctx) => [ctx.workspaceId],
  "inbox.replies": (ctx) => [ctx.workspaceId],
  "isolation.other_tenant": (ctx) => [ctx.workspaceId, ctx.otherWorkspaceId],
  "sync.upsert_batch": (ctx) => [ctx.workspaceId, ctx.locationId, ctx.seed, ctx.tenantIndex],
  "jobs.fail_stale": (ctx) => [ctx.workspaceId],
  "jobs.claim_quiet": (ctx) => [ctx.workspaceId],
  "insight.invalidate_rollback": (ctx) => [ctx.workspaceId],
};

export function bindWorkload(workload: Workload, ctx: WorkloadContext): unknown[] {
  const bind = BINDS[workload.id];
  if (!bind) throw new Error(`No parameter binder for ${workload.id}`);
  const values = bind(ctx);
  const used = [...workload.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const max = Math.max(...used);
  for (let slot = 1; slot <= max; slot += 1) {
    if (!used.includes(slot)) throw new Error(`${workload.id} skips $${slot}`);
  }
  if (values.length !== max) {
    throw new Error(`${workload.id} binds ${values.length} parameters but SQL uses $${max}`);
  }
  return values;
}
