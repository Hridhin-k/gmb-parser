import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const membership = await ensurePersonalWorkspace(user);
  const next = new URL(request.url).searchParams.get("next");
  const returnTo = next === "/onboarding" ? "/onboarding" : undefined;

  const url = GoogleOAuthService.createAuthorizationUrl(
    membership.workspace_id,
    user.id,
    returnTo
  );

  return NextResponse.redirect(url);
}
