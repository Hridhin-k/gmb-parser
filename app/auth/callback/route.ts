import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/types/supabase";
import { logger } from "@/lib/logger";
import { clearSupabaseAuthCookies } from "@/lib/supabase/clear-auth-cookies";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

function appOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (process.env.NODE_ENV !== "development" && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return url.origin;
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/overview";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const oauthDescription = url.searchParams.get("error_description");
  const next = safeNext(url.searchParams.get("next"));

  if (oauthError) {
    logger.error("auth.callback.oauth_error", {
      error: oauthError,
      description: oauthDescription?.slice(0, 200),
    });
    const login = new URL("/login", origin);
    login.searchParams.set("error", "auth_failed");
    login.searchParams.set("reason", oauthError);
    return NextResponse.redirect(login);
  }

  if (!code) {
    logger.error("auth.callback.missing_code", {});
    return NextResponse.redirect(`${origin}/login?error=auth_failed&reason=missing_code`);
  }

  const cookieStore = await cookies();
  const redirectTo = NextResponse.redirect(`${origin}${next}`);

  const { url: supabaseUrl, anonKey, projectRef } = getSupabasePublicConfig();
  const supabase = createServerClient<Database>(
    supabaseUrl,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
            redirectTo.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logger.error("auth.callback.exchange_failed", {
      message: error.message,
      status: error.status,
    });
    const login = new URL("/login", origin);
    login.searchParams.set("error", "auth_failed");
    login.searchParams.set(
      "reason",
      /code verifier|pkce/i.test(error.message) ? "pkce" : "exchange"
    );
    return NextResponse.redirect(login);
  }

  // Drop leftover sb-* cookies from other local projects so the next request
  // does not hit HTTP 431 from an oversized Cookie header. Keep this project's session.
  clearSupabaseAuthCookies(cookieStore, redirectTo, projectRef);
  return redirectTo;
}
