import { AppShell } from "@/components/app-shell";
import { ExitSupportButton } from "@/components/exit-support-button";
import { listAgencyClients } from "@/lib/services/agency-home";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { getShellSummary } from "@/lib/services/shell-summary";
import { getMemberAccess, visibleClientIds, visibleLocationIds } from "@/lib/services/access";
import { loadAgencyBranding } from "@/lib/services/agency-branding";
import { getActiveRole, getActiveWorkspace, getCurrentUser, tenantGateRedirect } from "@/lib/services/session";
import { listAccessibleWorkspaces } from "@/lib/services/workspace";
import { isSuperAdmin } from "@/lib/services/platform";
import { timed } from "@/lib/timing";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

async function activeWorkspaceOrGate() {
  try {
    return await getActiveWorkspace();
  } catch (error) {
    const user = await getCurrentUser();
    if (isSuperAdmin(user)) redirect("/admin");
    const target = tenantGateRedirect(error);
    if (target) redirect(target);
    throw error;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { user, workspaceId } = await activeWorkspaceOrGate();
  const [branding, workspaces] = await timed("layout.metadata", () =>
    Promise.all([
      loadAgencyBranding(workspaceId),
      listAccessibleWorkspaces(user.id),
    ])
  );
  const name = workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "Workspace";
  if (branding.hideProductName) return { title: name };
  return { title: "RevuPilot — Google review management" };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspaceId } = await timed("layout.workspace", () => activeWorkspaceOrGate());
  const { getMaintenance, getActiveAnnouncement } = await import("@/lib/services/platform");
  const { getSupportTenantId } = await import("@/lib/services/session");
  // One parallel wave for everything that only needs the user/workspace:
  // platform state (cross-request cached), access, role, workspaces, branding.
  const [maintenance, announcement, supportTenantId, access, role, workspaces, branding] =
    await timed("layout.context", () =>
      Promise.all([
        getMaintenance().catch(() => ({ enabled: false, message: null as string | null })),
        getActiveAnnouncement().catch(() => null),
        getSupportTenantId().catch(() => null),
        getMemberAccess(user.id, workspaceId),
        getActiveRole(),
        listAccessibleWorkspaces(user.id),
        loadAgencyBranding(workspaceId),
      ])
    );
  if (maintenance.enabled && !isSuperAdmin(user)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-medium text-graphite">RevuPilot is under maintenance</h1>
        <p className="mt-3 text-sm text-slate">{maintenance.message ?? "We're making improvements. Please check back shortly."}</p>
      </main>
    );
  }
  if (access && !access.enabled) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-medium text-graphite">Access is turned off</h1>
        <p className="mt-3 text-sm text-slate">
          An organization admin has to turn your access back on before you can open this workspace.
        </p>
      </main>
    );
  }
  const [allowedClientIds, locationIds] = await timed("layout.scope", () =>
    Promise.all([
      visibleClientIds(workspaceId, access?.scope),
      visibleLocationIds(workspaceId, access?.scope),
    ])
  );
  const [summary, catalog] = await timed("layout.shell", () =>
    Promise.all([
      getShellSummary(workspaceId, allowedClientIds, locationIds, user.id),
      loadScopeCatalog(user.id, workspaceId),
    ])
  );
  // The scope catalog already loaded (and scope-filtered) the client list in
  // this same request — reuse it instead of a second `grm_clients` round-trip.
  const clients = catalog
    ? catalog.clients.filter((client) => allowedClientIds === null || allowedClientIds.includes(client.id))
    : await listAgencyClients(workspaceId, allowedClientIds);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    (supportTenantId ? catalog?.workspaceName : null) ?? "Workspace";

  return (
    <>
      {supportTenantId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>Support view (read-only) — you are viewing <strong>{workspaceName}</strong> as a super admin. Changes are blocked.</span>
          <ExitSupportButton />
        </div>
      ) : null}
      {announcement ? (
        <div className={`px-4 py-2 text-sm ${announcement.tone === "warning" ? "bg-amber-100 text-amber-900" : "bg-paper text-graphite"}`}>
          <strong>{announcement.title}</strong> — {announcement.body}
        </div>
      ) : null}
    <AppShell
      user={user}
      role={role}
      workspaceName={workspaceName}
      workspaces={workspaces}
      activeWorkspaceId={workspaceId}
      clients={clients}
      catalog={catalog}
      summary={summary}
      logoUrl={branding.logoUrl}
      productTitle={branding.hideProductName ? workspaceName : "RevuPilot"}
    >
      {children}
    </AppShell>
    </>
  );
}
