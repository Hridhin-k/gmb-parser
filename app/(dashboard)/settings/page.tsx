import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { GoogleConnectionCard } from "@/components/google-connection-card";
import { WorkspaceMembersCard } from "@/components/workspace-members-card";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "You denied access to your Google account. You can try again when ready.",
  auth_failed: "Google authorization failed. Please try again.",
  missing_params: "The authorization response was incomplete. Please try again.",
  OAUTH_INVALID_STATE: "The authorization request was invalid or tampered with. Please try again.",
  OAUTH_STATE_EXPIRED: "The authorization request expired. Please try again.",
  OAUTH_TOKEN_EXCHANGE_FAILED:
    "Could not complete authorization with Google. Please try again.",
  OAUTH_NO_REFRESH_TOKEN:
    "Google did not grant offline access. Please revoke access in your Google account settings and try again.",
  OAUTH_INVALID_GRANT:
    "The authorization code was invalid or already used. Please try again.",
  unknown: "An unexpected error occurred. Please try again.",
};

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);
  const admin = createAdminClient();

  const [role, roster, { data }] = await Promise.all([
    getActiveRole(),
    getWorkspaceRoster(workspaceId),
    admin
      .from("grm_google_connections")
      .select("id, google_email, status, created_at, last_refreshed_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked")
      .order("created_at", { ascending: false }),
  ]);

  const connections = (data ?? []).map((c) => ({
    ...c,
    status: c.status as string,
  }));

  // Parse search params for post-OAuth redirect messages
  const googleError = typeof params.google_error === "string" ? params.google_error : null;
  const googleConnected = params.google_connected === "true";

  const errorMessage = googleError
    ? ERROR_MESSAGES[googleError] ?? ERROR_MESSAGES.unknown
    : null;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings"
        description="Manage your Google account connections and workspace settings."
      />

      <GoogleConnectionCard
        connections={connections}
        initialMessage={errorMessage}
        initialSuccess={googleConnected}
      />

      <WorkspaceMembersCard
        workspaceName={roster.name}
        currentUserId={user.id}
        currentRole={role}
        members={roster.members}
        invites={roster.invites}
      />
    </div>
  );
}
