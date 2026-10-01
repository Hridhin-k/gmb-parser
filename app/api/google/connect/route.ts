import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const membership = await ensurePersonalWorkspace(user);

  const url = GoogleOAuthService.createAuthorizationUrl(
    membership.workspace_id,
    user.id
  );

  return NextResponse.redirect(url);
}
