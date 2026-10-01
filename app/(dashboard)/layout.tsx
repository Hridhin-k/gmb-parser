import { AppShell } from "@/components/app-shell";
import { listAccessibleWorkspaces } from "@/lib/services/workspace";
import { getActiveWorkspace } from "@/lib/services/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspaceId } = await getActiveWorkspace();
  const workspaces = await listAccessibleWorkspaces(user.id);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Workspace";

  return (
    <AppShell
      user={user}
      workspaceName={workspaceName}
      workspaces={workspaces}
      activeWorkspaceId={workspaceId}
    >
      {children}
    </AppShell>
  );
}
