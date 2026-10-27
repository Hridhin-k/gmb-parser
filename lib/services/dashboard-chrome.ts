import type { User } from "@/lib/auth/types";
import { remember } from "@/lib/ttl-cache";
import type { GrmMemberRole } from "@/lib/types";
import { getMemberAccess, visibleClientIds, visibleLocationIds, type MemberAccess } from "@/lib/services/access";
import { loadAgencyBranding, type AgencyBranding } from "@/lib/services/agency-branding";
import { listAgencyClients } from "@/lib/services/agency-home";
import { getActiveAnnouncement, getMaintenance, isSuperAdmin, type PlatformAnnouncementRow } from "@/lib/services/platform";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import type { ScopeCatalog } from "@/lib/scope";
import { getActiveWorkspace, getCurrentUser, getSupportTenantId, tenantGateRedirect } from "@/lib/services/session";
import { getShellSummary, type ShellSummary } from "@/lib/services/shell-summary";
import { listAccessibleWorkspaces, type AccessibleWorkspace } from "@/lib/services/workspace";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";

const CHROME_TTL_MS = 60_000;

export interface DashboardChrome {
  user: User;
  workspaceId: string;
  role: GrmMemberRole | null;
  access: MemberAccess | null;
  workspaces: AccessibleWorkspace[];
  branding: AgencyBranding;
  summary: ShellSummary;
  catalog: ScopeCatalog | null;
  clients: Array<{ id: string; name: string }>;
  workspaceName: string;
  maintenance: { enabled: boolean; message: string | null };
  announcement: PlatformAnnouncementRow | null;
  supportTenantId: string | null;
}

/**
 * Sidebar, scope, and tenant identity for the signed-in app.
 * Reused for a few seconds so moving between pages does not repeat it.
 */
export async function loadDashboardChrome(): Promise<DashboardChrome> {
  try {
    const [{ user, workspaceId }, supportTenantId] = await Promise.all([
      getActiveWorkspace(),
      getSupportTenantId(),
    ]);
    return remember(`chrome:${user.id}:${workspaceId}`, CHROME_TTL_MS, () =>
      buildDashboardChrome(user, workspaceId, supportTenantId)
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const user = await getCurrentUser();
    if (isSuperAdmin(user)) redirect("/admin");
    const target = tenantGateRedirect(error);
    if (target) redirect(target);
    throw error;
  }
}

async function buildDashboardChrome(
  user: User,
  workspaceId: string,
  supportTenantId: string | null
): Promise<DashboardChrome> {
  const [maintenance, announcement, access, workspaces, branding] = await Promise.all([
    getMaintenance().catch(() => ({ enabled: false, message: null as string | null })),
    getActiveAnnouncement().catch(() => null),
    getMemberAccess(user.id, workspaceId),
    listAccessibleWorkspaces(user.id),
    loadAgencyBranding(workspaceId),
  ]);
  const role = (access?.role as GrmMemberRole | undefined) ?? null;
  const [allowedClientIds, locationIds] = await Promise.all([
    visibleClientIds(workspaceId, access?.scope),
    visibleLocationIds(workspaceId, access?.scope),
  ]);
  const [summary, catalog] = await Promise.all([
    getShellSummary(workspaceId, allowedClientIds, locationIds, user.id),
    loadScopeCatalog(user.id, workspaceId),
  ]);
  const clients = catalog
    ? catalog.clients.filter((client) => allowedClientIds === null || allowedClientIds.includes(client.id))
    : await listAgencyClients(workspaceId, allowedClientIds);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    (supportTenantId ? catalog?.workspaceName : null) ??
    "Workspace";

  return {
    user,
    workspaceId,
    role,
    access,
    workspaces,
    branding,
    summary,
    catalog,
    clients,
    workspaceName,
    maintenance,
    announcement,
    supportTenantId,
  };
}
