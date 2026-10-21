/**
 * Platform super-admin + tenant-invite rules (pure).
 *
 * Super admins are an env allowlist (SUPER_ADMIN_EMAILS, comma separated) —
 * deliberately not a DB role, so a compromised tenant admin cannot grant
 * themselves platform access. Tenant invites last 7 days.
 */

export const PLATFORM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function parseSuperAdminEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((part) => normalizeEmail(part)).filter((part) => part.includes("@")))];
}

export function isSuperAdminEmail(
  email: string | null | undefined,
  rawList: string | null | undefined = process.env.SUPER_ADMIN_EMAILS
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return parseSuperAdminEmails(rawList).includes(normalized);
}

export function platformInviteExpiresAt(from = Date.now()): string {
  return new Date(from + PLATFORM_INVITE_TTL_MS).toISOString();
}

export function isPlatformInviteExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const time = Date.parse(expiresAt);
  return !Number.isFinite(time) || time <= now;
}

export const SUPPORT_TENANT_COOKIE = "grm_support_tenant";

export type TenantGateKind =
  | "allowed" // has an active workspace membership (incl. grandfathered + team invites)
  | "setup" // has a live platform invite, must name & create the tenant
  | "not_invited" // no membership, no live platform invite
  | "suspended" // every membership is in a suspended workspace
  | "deleted" // every membership is in a soft-deleted workspace
  | "blocked" // email is on the platform blocklist
  | "plan_expired"; // active workspace whose plan/trial end date has passed

/**
 * Decide what a signed-in user may do. Memberships win over platform invites
 * (a team invite into an existing tenant is a complete path in). Suspended /
 * deleted only block when there is no active workspace left to open.
 */
export function tenantGate(input: {
  workspaceStatuses: Array<string | null | undefined>;
  hasLivePlatformInvite: boolean;
}): TenantGateKind {
  const statuses = input.workspaceStatuses.map((s) => s ?? "active");
  if (statuses.includes("active")) return "allowed";
  if (statuses.length > 0) {
    return statuses.every((s) => s === "deleted") ? "deleted" : "suspended";
  }
  return input.hasLivePlatformInvite ? "setup" : "not_invited";
}
