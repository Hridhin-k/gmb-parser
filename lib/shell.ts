import { allows, workspaceGrant } from "@/lib/access";
import { parseDateRange, type DateRangeKey } from "@/lib/date-range";

export type ShellRole = "owner" | "admin" | "member" | string | null | undefined;

/** Routes whose client and date query params the header is allowed to change. */
const CLIENT_AND_RANGE = [
  "/overview",
  "/reviews",
  "/escalations",
  "/analytics",
  "/insights",
  "/reports",
  "/dashboard",
] as const;

const CLIENT_ONLY = ["/requests"] as const;

export function isManager(role: ShellRole): boolean {
  return (
    workspaceGrant(role, "edit_rules") ||
    allows(role, "manage_locations") ||
    allows(role, "manage_people")
  );
}

export function canOpenTeam(role: ShellRole): boolean {
  return allows(role, "manage_people") || role === "admin";
}

export function canOpenSettings(role: ShellRole): boolean {
  return role === "owner" || role === "org_admin" || role === "admin" || allows(role, "edit_rules");
}

export function isOwner(role: ShellRole): boolean {
  return role === "owner";
}

export interface ShellProfileAttention {
  id: string;
  name: string;
  unreplied: number;
  escalations: number;
  drafts: number;
  failed: number;
}

export interface ShellNotice {
  id: string;
  title: string;
  href: string;
}

export interface ShellAlertInput {
  unreplied: number;
  escalations: number;
  drafts: number;
  failed?: number;
  expiredConnections: number;
  /** Set for a person scoped to a brand, group, or outlet. Empty for the whole organisation. */
  profiles?: ShellProfileAttention[];
  notices?: ShellNotice[];
}

export interface ShellAlert {
  id: string;
  title: string;
  href: string;
}

function profileAlert(profile: ShellProfileAttention): ShellAlert | null {
  const parts: string[] = [];
  if (profile.escalations > 0) {
    parts.push(`${profile.escalations.toLocaleString("en-US")} open ${profile.escalations === 1 ? "escalation" : "escalations"}`);
  }
  if (profile.failed > 0) {
    parts.push(`${profile.failed.toLocaleString("en-US")} failed ${profile.failed === 1 ? "publish" : "publishes"}`);
  }
  if (profile.unreplied > 0) {
    parts.push(`${profile.unreplied.toLocaleString("en-US")} with no reply`);
  }
  if (profile.drafts > 0) {
    parts.push(`${profile.drafts.toLocaleString("en-US")} ${profile.drafts === 1 ? "draft" : "drafts"}`);
  }
  if (parts.length === 0) return null;
  const href = profile.escalations
    ? `/escalations?location=${profile.id}`
    : profile.failed
      ? `/reviews?location=${profile.id}&filter=failed`
      : profile.unreplied
        ? `/reviews?location=${profile.id}&filter=unanswered`
        : `/reviews?location=${profile.id}&filter=draft`;
  return { id: `profile:${profile.id}`, title: `${profile.name} · ${parts.join(", ")}`, href };
}

function attentionScore(profile: ShellProfileAttention): number {
  return profile.escalations * 1_000_000 + profile.failed * 10_000 + profile.unreplied * 100 + profile.drafts;
}

/** Only alerts the person can open. Scoped people see each of their profiles. */
export function shellAlerts(summary: ShellAlertInput, role: ShellRole): ShellAlert[] {
  const items: ShellAlert[] = [];
  for (const notice of (summary.notices ?? []).slice(0, 8)) {
    items.push({ id: `notice:${notice.id}`, title: notice.title, href: notice.href });
  }
  const built = [...(summary.profiles ?? [])]
    .sort((a, b) => attentionScore(b) - attentionScore(a) || a.name.localeCompare(b.name))
    .map(profileAlert)
    .filter((item): item is ShellAlert => Boolean(item));
  if (built.length > 0) {
    items.push(...built.slice(0, 8));
    if (built.length > 8) {
      items.push({ id: "more-profiles", title: "More of your profiles need attention", href: "/reviews?filter=unanswered" });
    }
  } else {
    if (summary.escalations > 0) {
      items.push({
        id: "escalations",
        title: `${summary.escalations.toLocaleString("en-US")} open escalations`,
        href: "/escalations",
      });
    }
    if ((summary.failed ?? 0) > 0) {
      items.push({
        id: "failed",
        title: `${(summary.failed ?? 0).toLocaleString("en-US")} replies failed to publish`,
        href: "/reviews?filter=failed",
      });
    }
    if (summary.unreplied > 0) {
      items.push({
        id: "unreplied",
        title: `${summary.unreplied.toLocaleString("en-US")} reviews have no reply`,
        href: "/reviews?filter=unanswered",
      });
    }
    if (summary.drafts > 0) {
      items.push({
        id: "drafts",
        title: `${summary.drafts.toLocaleString("en-US")} drafts are ready to approve`,
        href: "/reviews?filter=draft",
      });
    }
  }
  if (summary.expiredConnections > 0 && canOpenPath("/settings", role)) {
    items.push({
      id: "connections",
      title: `${summary.expiredConnections.toLocaleString("en-US")} Google connections expired`,
      href: "/settings",
    });
  }
  return items;
}

export type ShellNavId =
  | "overview"
  | "inbox"
  | "escalations"
  | "analytics"
  | "insights"
  | "reports"
  | "requests"
  | "locations"
  | "team"
  | "settings"
  | "clients"
  | "usage";

const EVERYONE: ShellNavId[] = [
  "overview",
  "inbox",
  "escalations",
  "analytics",
  "insights",
  "reports",
  "requests",
  "locations",
];

export function visibleNav(role: ShellRole): ShellNavId[] {
  const items = [...EVERYONE];
  if (isManager(role)) items.push("clients");
  if (canOpenTeam(role)) items.push("team");
  if (canOpenSettings(role)) items.push("settings");
  if (allows(role, "manage_people")) items.push("usage");
  return items;
}

export function canOpenPath(pathname: string, role: ShellRole): boolean {
  if (pathname === "/team" || pathname.startsWith("/team/")) return canOpenTeam(role);
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return canOpenSettings(role);
  if (pathname === "/audit" || pathname.startsWith("/audit/")) return canOpenTeam(role);
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return isManager(role);
  return true;
}

export type ScopeMode = "none" | "client" | "client-range";

export function scopeMode(pathname: string): ScopeMode {
  const path = pathname.split("?")[0] ?? pathname;
  if (CLIENT_AND_RANGE.some((item) => path === item)) return "client-range";
  if (CLIENT_ONLY.some((item) => path === item)) return "client";
  return "none";
}

export function defaultRangeForPath(pathname: string): DateRangeKey {
  if (pathname === "/overview") return "12m";
  if (pathname === "/analytics") return "12m";
  if (pathname === "/insights") return "12m";
  if (pathname === "/dashboard" || pathname === "/reports") return "1m";
  return "all";
}

/**
 * Organisation and date the user has applied. An explicit range in the URL
 * wins. When the URL has none, the page they are leaving contributes its
 * current period, so the next page does not substitute its own default.
 */
export function globalFilterParams(current: URLSearchParams, pathname: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["client", "group", "location"] as const) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  if (current.has("range") || current.has("from") || current.has("to")) {
    for (const key of ["range", "from", "to"] as const) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
    return params;
  }
  const range = parseDateRange({}, defaultRangeForPath(pathname));
  params.set("range", range.key);
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  return params;
}

/**
 * Carry the applied organisation and date onto the next page.
 * A link that already names a place or a period keeps that value.
 */
export function scopedHref(path: string, current: URLSearchParams, pathname: string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;

  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
  const carried = globalFilterParams(current, pathname);
  for (const key of ["client", "group", "location", "range", "from", "to"] as const) {
    if (params.has(key)) continue;
    const value = carried.get(key);
    if (value) params.set(key, value);
  }

  const qs = params.toString();
  return `${base}${qs ? `?${qs}` : ""}${hash}`;
}
