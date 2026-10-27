/**
 * Route → loader → database/RPC map for Phase 4 authenticated HTTP benchmarks.
 *
 * Auth path (every dashboard HTML request):
 *   browser → proxy.ts (Supabase cookie session / getUser) →
 *   app/(dashboard)/layout.tsx (loadDashboardChrome → session + catalog/shell) →
 *   page.tsx loaders → createAdminClient() (service_role; app-layer workspace scope) →
 *   PostgREST / RPCs → RSC HTML
 *
 * Process-local caches (see lib/services/dashboard-cache.ts): dashctx/slice/insights 45s,
 * inbox 20s, catalog/shell/chrome/roster 60s. Not shared across Node instances.
 */

export type HttpRouteKind = "document" | "api";

export type HttpRouteDef = {
  id: string;
  path: string;
  kind: HttpRouteKind;
  range?: string;
  scope?: "org" | "client" | "group" | "location";
  /** Expected primary loaders (documentation; not enforced at runtime). */
  loaders: string[];
  /** Expected RPCs / heavy queries when caches miss. */
  rpcs: string[];
  notes?: string;
};

export type ScopeIds = {
  clientId?: string;
  groupId?: string;
  locationId?: string;
};

export function buildHttpRoutes(scopes: ScopeIds = {}): HttpRouteDef[] {
  const client = scopes.clientId ? `&client=${scopes.clientId}` : "";
  const group = scopes.groupId ? `&group=${scopes.groupId}` : "";
  const location = scopes.locationId ? `&location=${scopes.locationId}` : "";

  const routes: HttpRouteDef[] = [
    {
      id: "overview_30d",
      path: "/overview?range=1m",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: [
        "getActiveWorkspace",
        "readPageScope",
        "getDashboardContext",
        "loadOverviewSignals",
        "loadInsightDashboard",
        "getReportByCacheKey",
      ],
      rpcs: [
        "grm_dashboard_bundle×2 (current+previous)",
        "grm_star_breakdown",
        "grm_overview_signals / grm_review_trends",
        "grm_insight_dashboard",
        "catalog tables + report cache rows",
      ],
    },
    {
      id: "analytics_performance_30d",
      path: "/analytics?range=1m",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: ["getDashboardContext", "loadAnalyticsSlice"],
      rpcs: ["grm_dashboard_bundle×2", "grm_star_breakdown", "grm_analytics_slice"],
      notes: "section default=performance; themes/roster skipped",
    },
    {
      id: "analytics_themes_30d",
      path: "/analytics?range=1m&section=themes",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: ["getDashboardContext", "loadInsightDashboard"],
      rpcs: ["grm_dashboard_bundle×2", "grm_star_breakdown", "grm_insight_dashboard"],
    },
    {
      id: "analytics_profile_30d",
      path: "/analytics?range=1m&section=profile",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: ["getDashboardContext"],
      rpcs: ["grm_dashboard_bundle×2", "grm_star_breakdown"],
      notes: "slice/insights/roster skipped",
    },
    {
      id: "analytics_automation_30d",
      path: "/analytics?range=1m&section=automation",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: ["getDashboardContext"],
      rpcs: ["grm_dashboard_bundle×2", "grm_star_breakdown"],
    },
    {
      id: "analytics_team_30d",
      path: "/analytics?range=1m&section=team",
      kind: "document",
      range: "1m",
      scope: "org",
      loaders: ["getDashboardContext", "getWorkspaceRoster"],
      rpcs: ["grm_dashboard_bundle×2", "grm_star_breakdown", "roster members query"],
    },
    {
      id: "inbox_recent",
      path: "/reviews",
      kind: "document",
      range: "all",
      scope: "org",
      loaders: ["getDashboardData", "getWorkspaceRoster"],
      rpcs: ["catalog", "reviews select page", "optional grm_location_review_stats"],
    },
    {
      id: "inbox_unanswered",
      path: "/reviews?filter=unanswered",
      kind: "document",
      range: "all",
      scope: "org",
      loaders: ["getDashboardData"],
      rpcs: ["catalog", "filtered reviews page"],
    },
    {
      id: "inbox_low_rating",
      path: "/reviews?stars=low",
      kind: "document",
      range: "all",
      scope: "org",
      loaders: ["getDashboardData"],
      rpcs: ["catalog", "rating-filtered reviews page"],
    },
    {
      id: "inbox_search",
      path: "/reviews?q=service",
      kind: "document",
      range: "all",
      scope: "org",
      loaders: ["getDashboardData"],
      rpcs: ["catalog", "ilike-filtered reviews page"],
      notes: "Search term is a synthetic keyword; response body is not logged.",
    },
  ];

  if (scopes.clientId) {
    routes.push({
      id: "overview_client_30d",
      path: `/overview?range=1m${client}`,
      kind: "document",
      range: "1m",
      scope: "client",
      loaders: ["getDashboardContext", "loadOverviewSignals", "loadInsightDashboard"],
      rpcs: ["grm_dashboard_bundle×2 (client scope)", "grm_star_breakdown", "signals", "insights"],
    });
  }
  if (scopes.groupId) {
    routes.push({
      id: "overview_group_30d",
      path: `/overview?range=1m${group}`,
      kind: "document",
      range: "1m",
      scope: "group",
      loaders: ["getDashboardContext"],
      rpcs: ["grm_dashboard_bundle×2 (group scope)", "grm_star_breakdown"],
    });
  }
  if (scopes.locationId) {
    routes.push({
      id: "overview_location_30d",
      path: `/overview?range=1m${location}`,
      kind: "document",
      range: "1m",
      scope: "location",
      loaders: ["getDashboardContext"],
      rpcs: ["grm_dashboard_bundle×2 (location scope)", "grm_star_breakdown"],
    });
  }

  routes.push({
    id: "overview_alltime",
    path: "/overview?range=all",
    kind: "document",
    range: "all",
    scope: "org",
    loaders: ["getDashboardContext", "loadOverviewSignals", "loadInsightDashboard"],
    rpcs: ["grm_dashboard_bundle×1 (no previous)", "grm_star_breakdown", "signals", "insights"],
  });

  return routes;
}

/** Representative mix for concurrency (avoids hammering one endpoint). */
export function concurrencyMix(routes: HttpRouteDef[]): HttpRouteDef[] {
  const want = [
    "overview_30d",
    "analytics_performance_30d",
    "analytics_themes_30d",
    "inbox_recent",
    "inbox_unanswered",
    "overview_location_30d",
    "overview_group_30d",
    "overview_client_30d",
  ];
  const byId = new Map(routes.map((route) => [route.id, route]));
  return want.map((id) => byId.get(id)).filter((route): route is HttpRouteDef => Boolean(route));
}
