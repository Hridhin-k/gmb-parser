import { AppShell } from "@/components/app-shell";
import { listAgencyClients } from "@/lib/services/agency-home";
import { getShellSummary } from "@/lib/services/shell-summary";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { loadAgencyBranding } from "@/lib/services/agency-branding";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { listAccessibleWorkspaces } from "@/lib/services/workspace";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { user, workspaceId } = await getActiveWorkspace();
  const [branding, workspaces] = await Promise.all([
    loadAgencyBranding(workspaceId),
    listAccessibleWorkspaces(user.id),
  ]);
  const name = workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "Workspace";
  if (branding.hideProductName) return { title: name };
  return { title: "GRM — Google review management" };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspaceId } = await getActiveWorkspace();
  const access = await getMemberAccess(user.id, workspaceId);
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
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const [workspaces, clients, role, summary, branding] = await Promise.all([
    listAccessibleWorkspaces(user.id),
    listAgencyClients(workspaceId, allowedClientIds),
    getActiveRole(),
    getShellSummary(workspaceId, allowedClientIds),
    loadAgencyBranding(workspaceId),
  ]);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Workspace";

  return (
    <AppShell
      user={user}
      role={role}
      workspaceName={workspaceName}
      workspaces={workspaces}
      activeWorkspaceId={workspaceId}
      clients={clients}
      summary={summary}
      logoUrl={branding.logoUrl}
      productTitle={branding.hideProductName ? workspaceName : "GRM"}
    >
      {children}
    </AppShell>
  );
}
