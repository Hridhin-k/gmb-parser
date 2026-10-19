import { allows, workspaceGrant } from "@/lib/access";
import { dateRangeParams, parseDateRange, type DateRangeKey } from "@/lib/date-range";

export type ShellRole = "owner" | "admin" | "member" | string | null | undefined;

/** Routes whose client and date query params the header is allowed to change. */
const CLIENT_AND_RANGE = [
  "/overview",
  "/reviews",
  "/escalations",
  "/analytics",
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

export interface ShellAlertInput {
  unreplied: number;
  escalations: number;
  drafts: number;
  expiredConnections: number;
}

export interface ShellAlert {
  id: string;
  title: string;
  href: string;
}

/** Only alerts the person can open. Each item links to the screen that does the work. */
export function shellAlerts(summary: ShellAlertInput, role: ShellRole): ShellAlert[] {
  const items: ShellAlert[] = [];
  if (summary.escalations > 0) {
    items.push({
      id: "escalations",
      title: `${summary.escalations.toLocaleString("en-US")} open escalations`,
      href: "/escalations",
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
  if (pathname === "/analytics") return "6m";
  if (pathname === "/dashboard" || pathname === "/reports") return "1m";
  return "all";
}

/**
 * Carry the client and the effective date range onto another scoped route.
 * A page's own default is expanded first, so leaving Overview for Inbox keeps
 * "Last 12 months" instead of silently switching to all time.
 */
export function scopedHref(path: string, current: URLSearchParams, pathname: string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  if (scopeMode(base) === "none") return path;

  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
  const client = current.get("client");
  if (client) params.set("client", client);

  if (scopeMode(base) === "client-range") {
    const range = parseDateRange(
      {
        range: current.get("range") ?? undefined,
        from: current.get("from") ?? undefined,
        to: current.get("to") ?? undefined,
      },
      defaultRangeForPath(pathname)
    );
    for (const [key, value] of Object.entries(dateRangeParams(range, "all"))) {
      params.set(key, value);
    }
  } else {
    params.delete("range");
    params.delete("from");
    params.delete("to");
  }

  const qs = params.toString();
  return `${base}${qs ? `?${qs}` : ""}${hash}`;
}
