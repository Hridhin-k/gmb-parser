import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // User denied authorization at Google
  if (error === "access_denied") {
    return NextResponse.redirect(
      `${origin}/settings?google_error=access_denied`
    );
  }

  if (error) {
    return NextResponse.redirect(
      `${origin}/settings?google_error=auth_failed`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/settings?google_error=missing_params`
    );
  }

  try {
    await GoogleOAuthService.handleCallback(code, state);
    return NextResponse.redirect(`${origin}/settings?google_connected=true`);
  } catch (err) {
    const errorCode =
      err instanceof AppError ? err.code : "unknown";

    logger.error("google.oauth.callback.failed", {
      errorCode,
      message: err instanceof Error ? err.message : "Unknown",
    });

    return NextResponse.redirect(
      `${origin}/settings?google_error=${encodeURIComponent(errorCode)}`
    );
  }
}
