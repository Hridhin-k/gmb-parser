import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { saveOnboardingStep } from "@/lib/services/onboarding";
import { completeOnboardingLink } from "@/lib/services/agency-clients";
import { recordUsageEvent } from "@/lib/services/usage-events";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const base = (() => {
    if (!state) return `${origin}/settings`;
    try {
      const payload = GoogleOAuthService.validateState(state);
      return GoogleOAuthService.returnPath(payload) === "/onboarding"
        ? `${origin}/onboarding?step=connect`
        : `${origin}/settings`;
    } catch {
      return `${origin}/settings`;
    }
  })();

  function withGoogleError(code: string): string {
    const url = new URL(base);
    url.searchParams.set("google_error", code);
    return url.toString();
  }

  // User denied authorization at Google
  if (error === "access_denied") {
    return NextResponse.redirect(withGoogleError("access_denied"));
  }

  if (error) {
    return NextResponse.redirect(withGoogleError("auth_failed"));
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/settings?google_error=missing_params`
    );
  }

  let setup = false;
  let workspaceId = "";
  let userId = "";
  let clientId = "";
  let onboardingId = "";
  try {
    const payload = GoogleOAuthService.validateState(state);
    setup = GoogleOAuthService.returnPath(payload) === "/onboarding";
    workspaceId = payload.workspaceId;
    userId = payload.userId;
    clientId = payload.clientId ?? "";
    onboardingId = payload.onboardingId ?? "";
  } catch (err) {
    const errorCode = err instanceof AppError ? err.code : "unknown";
    return NextResponse.redirect(
      `${origin}/settings?google_error=${encodeURIComponent(errorCode)}`
    );
  }

  const failurePage = setup ? `${origin}/onboarding?step=connect` : `${origin}/settings`;

  try {
    const connected = await GoogleOAuthService.handleCallback(code, state);
    if (clientId && onboardingId) {
      await completeOnboardingLink(onboardingId);
      await recordUsageEvent({
        workspaceId,
        clientId,
        kind: "client_connected",
        sourceId: connected.googleEmail,
      });
      return NextResponse.redirect(`${origin}/c/done`);
    }
    if (setup) {
      try {
        await saveOnboardingStep(workspaceId, userId, "import");
      } catch (stepError) {
        logger.error("google.oauth.onboarding_step_failed", {
          message: stepError instanceof Error ? stepError.message : "Unknown",
        });
      }
      return NextResponse.redirect(`${origin}/onboarding?step=import&google_connected=true`);
    }
    return NextResponse.redirect(`${origin}/settings?google_connected=true`);
  } catch (err) {
    const errorCode =
      err instanceof AppError ? err.code : "unknown";

    logger.error("google.oauth.callback.failed", {
      errorCode,
      message: err instanceof Error ? err.message : "Unknown",
    });

    return NextResponse.redirect(
      `${failurePage}${failurePage.includes("?") ? "&" : "?"}google_error=${encodeURIComponent(errorCode)}`
    );
  }
}
