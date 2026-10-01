import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ensurePersonalWorkspace,
  listAccessibleWorkspaces,
} from "@/lib/services/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await ensurePersonalWorkspace(user);
  const workspaces = await listAccessibleWorkspaces(user.id);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === membership.workspace_id)?.name ??
    "Workspace";

  return (
    <AppShell
      user={user}
      workspaceName={workspaceName}
      workspaces={workspaces}
      activeWorkspaceId={membership.workspace_id}
    >
      {children}
    </AppShell>
  );
}
