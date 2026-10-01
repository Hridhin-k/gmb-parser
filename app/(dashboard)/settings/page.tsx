import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleConnectionCard } from "@/components/google-connection-card";

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
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get the user's workspace membership
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single();

  // Fetch connections for the workspace (safe — no token columns)
  let connections: Array<{
    id: string;
    google_email: string;
    status: string;
    created_at: string;
    last_refreshed_at: string | null;
  }> = [];

  if (membership) {
    const { data } = await admin
      .from("grm_google_connections")
      .select("id, google_email, status, created_at, last_refreshed_at")
      .eq("workspace_id", membership.workspace_id)
      .neq("status", "revoked")
      .order("created_at", { ascending: false });

    connections = (data ?? []).map((c) => ({
      ...c,
      status: c.status as string,
    }));
  }

  // Parse search params for post-OAuth redirect messages
  const googleError = typeof params.google_error === "string" ? params.google_error : null;
  const googleConnected = params.google_connected === "true";

  const errorMessage = googleError
    ? ERROR_MESSAGES[googleError] ?? ERROR_MESSAGES.unknown
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your Google account connections and workspace settings."
      />

      <GoogleConnectionCard
        connections={connections}
        initialMessage={errorMessage}
        initialSuccess={googleConnected}
      />

      <Card className="border-gray-200 shadow-none">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-gray-700">
            Workspace
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Workspace details and member management will be available here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
