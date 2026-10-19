import { NextResponse } from "next/server";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { readOnboardingLink } from "@/lib/services/agency-clients";

/** Public start of the client's own Google consent. The link is the secret. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const link = await readOnboardingLink(token);
  if (link.state !== "open" || !link.workspaceId || !link.clientId || !link.onboardingId || !link.createdBy) {
    return NextResponse.redirect(new URL("/c/done?expired=1", request.url));
  }
  const url = GoogleOAuthService.createAuthorizationUrl(
    link.workspaceId,
    link.createdBy,
    undefined,
    { clientId: link.clientId, onboardingId: link.onboardingId }
  );
  return NextResponse.redirect(url);
}
