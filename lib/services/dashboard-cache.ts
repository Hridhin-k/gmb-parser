import { forget, forgetKeysMatching, forgetPrefix } from "@/lib/ttl-cache";

/**
 * Process-local dashboard cache inventory (Vercel Hobby / one Node instance):
 *
 * | Prefix / key                         | TTL   | Dimensions                                      | Invalidated by                          |
 * |--------------------------------------|-------|-------------------------------------------------|-----------------------------------------|
 * | `dashctx:{workspace}:…`              | 45s   | workspace, client, group, location, start, end  | review sync / reply / this helper       |
 * | `slice:{workspace}:…`                | 45s   | workspace, start, end, sorted location ids      | same                                    |
 * | `insights:{workspace}:…`             | 45s   | workspace, start, end, sorted location ids      | same                                    |
 * | `signals:{workspace}:…`              | 45s   | workspace, day-bounded range, location ids      | same                                    |
 * | `onboard-gate:{workspace}`           | 60s   | workspace                                       | same                                    |
 * | `inbox:{workspace}:…`                | 20s   | workspace + filter JSON                         | same                                    |
 * | `review-count:{workspace}:…`         | 45s   | workspace + export filters                      | same                                    |
 * | `catalog:{workspace}`                | 60s   | workspace                                       | same + bustCatalogCache                 |
 * | `shell:{user}:{workspace}:…`         | 60s   | user, workspace, visible clients/locations      | same + forgetUserNavigation             |
 * | `chrome:{user}:{workspace}`          | 60s   | user, workspace                                 | forgetUserNavigation only               |
 * | `roster:{workspace}`                 | 60s   | workspace                                       | membership mutations (workspace.ts)     |
 *
 * Not shared across Vercel instances. TTL remains the hard freshness ceiling
 * when invalidation is skipped (failed sync must not pretend data changed).
 */

/**
 * Rolling preset windows use `monthsBefore(now)`, so a full ISO timestamp
 * changes every millisecond and defeats the 45s TTL. Cache keys keep the UTC
 * calendar day only; RPC callers still pass the exact bounds for the query.
 */
export function cacheDayBound(isoOrDay: string | null | undefined): string | null {
  if (!isoOrDay) return null;
  return isoOrDay.slice(0, 10);
}

/** Stable key for Overview / Analytics dashboard context. */
export function dashboardContextCacheKey(
  workspaceId: string,
  scope: { clientId: string | null; groupId: string | null; locationId: string | null },
  range: { start: string | null; end: string | null }
): string {
  return [
    "dashctx",
    workspaceId,
    scope.clientId ?? "",
    scope.groupId ?? "",
    scope.locationId ?? "",
    cacheDayBound(range.start) ?? "",
    cacheDayBound(range.end) ?? "",
  ].join(":");
}

/** Stable key for analytics slice / insight dashboard location windows. */
export function locationWindowCacheKey(
  prefix: "slice" | "insights" | "signals",
  workspaceId: string,
  locationIds: readonly string[],
  start: string | null,
  end: string | null
): string {
  const places = [...locationIds].sort().join(",");
  return `${prefix}:${workspaceId}:${cacheDayBound(start) ?? ""}:${cacheDayBound(end) ?? ""}:${places}`;
}

/**
 * Drop review-derived dashboard entries for one workspace after a successful
 * write. Does not flush other tenants. Leaves chrome/roster alone unless the
 * caller also changes membership.
 */
export function forgetWorkspaceDashboardCaches(workspaceId: string): void {
  if (!workspaceId) return;
  forgetPrefix(`dashctx:${workspaceId}:`);
  forgetPrefix(`slice:${workspaceId}:`);
  forgetPrefix(`insights:${workspaceId}:`);
  forgetPrefix(`signals:${workspaceId}:`);
  forgetPrefix(`inbox:${workspaceId}:`);
  forgetPrefix(`review-count:${workspaceId}:`);
  forgetPrefix(`onboard-gate:${workspaceId}`);
  forget(`catalog:${workspaceId}`);
  forgetKeysMatching(
    (key) => key.startsWith("shell:") && key.includes(`:${workspaceId}:`)
  );
}
