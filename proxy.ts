import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { serverTimingHeader } from "@/lib/timing";

const PUBLIC_PATHS = [
  "/login",
  "/privacy",
  "/terms",
  "/auth/callback",
  "/api/auth",
  "/api/google/callback",
  "/api/google/client-connect",
  "/c/",
  "/api/cron",
  "/r",
  "/api/requests/hooks",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read-only support view: a super admin viewing a tenant cannot mutate anything in it.
  const supportTenant = request.cookies.get("grm_support_tenant")?.value;
  if (
    supportTenant &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    pathname.startsWith("/api/") &&
    !pathname.includes("/impersonate") &&
    !pathname.startsWith("/api/auth")
  ) {
    return NextResponse.json(
      { error: "Support view is read-only. Exit support view to make changes in your own account." },
      { status: 403 }
    );
  }

  if (pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-grm-path", pathname);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Local JWT verification against the project's JWKS (ES256 asymmetric
  // keys, cached globally) instead of an Auth-server round trip per request.
  // getClaims falls back to server verification automatically if needed.
  const authStart = performance.now();
  const { data: claimsData } = await supabase.auth.getClaims();
  const authMs = performance.now() - authStart;
  const claims = claimsData?.claims ?? null;
  const user = claims ? { id: claims.sub, email: claims.email ?? null } : null;
  const timing = serverTimingHeader([
    ["proxy-auth", authMs],
    ["proxy", performance.now() - authStart],
  ]);
  response.headers.set("Server-Timing", timing);

  if (!user && !pathname.startsWith("/login")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    redirectResponse.headers.set("Server-Timing", timing);
    return redirectResponse;
  }

  if (user && pathname === "/login") {
    const superAdmins = (process.env.SUPER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const isSuperAdmin = Boolean(user.email && superAdmins.includes(user.email.toLowerCase()));
    const redirectResponse = NextResponse.redirect(new URL(isSuperAdmin ? "/admin" : "/overview", request.url));
    redirectResponse.headers.set("Server-Timing", timing);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
