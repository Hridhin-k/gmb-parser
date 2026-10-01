import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleOAuthService } from "@/lib/services/google-oauth";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Get the user's workspace
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "No workspace found. Please contact support." },
      { status: 403 }
    );
  }

  const url = GoogleOAuthService.createAuthorizationUrl(
    membership.workspace_id,
    user.id
  );

  return NextResponse.redirect(url);
}
