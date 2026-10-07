import { AppShell } from "@/components/app-shell";
import { listAgencyClients } from "@/lib/services/agency-home";
import { listAccessibleWorkspaces } from "@/lib/services/workspace";
import { getActiveWorkspace } from "@/lib/services/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspaceId } = await getActiveWorkspace();
  const [workspaces, clients] = await Promise.all([
    listAccessibleWorkspaces(user.id),
    listAgencyClients(workspaceId),
  ]);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Workspace";

  return (
    <AppShell
      user={user}
      workspaceName={workspaceName}
      workspaces={workspaces}
      activeWorkspaceId={workspaceId}
      clients={clients}
    >
      {children}
    </AppShell>
  );
}
