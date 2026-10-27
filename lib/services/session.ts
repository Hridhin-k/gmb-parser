import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { GrmMemberRole } from "@/lib/types";
import { hasUserConsent } from "./consent";
import { ensurePersonalWorkspace, getMemberRole } from "./workspace";
import { AppError } from "@/lib/errors";
import { SUPPORT_TENANT_COOKIE } from "@/lib/platform-admin";
import { peek, put } from "@/lib/ttl-cache";

/** Where the invite-only gate sends each refusal. Returns null for other errors. */
export function tenantGateRedirect(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  switch (error.code) {
    case "TENANT_SETUP_REQUIRED":
      return "/create-tenant";
    case "PLATFORM_NOT_INVITED":
      return "/not-invited";
    case "WORKSPACE_SUSPENDED":
      return "/not-invited?reason=suspended";
    case "WORKSPACE_DELETED":
      return "/not-invited?reason=deleted";
    case "PLATFORM_BLOCKED":
      return "/not-invited?reason=blocked";
    case "PLAN_EXPIRED":
      return "/not-invited?reason=plan_expired";
    default:
      return null;
  }
}

// Wrapped in React `cache` so a layout and its page share one lookup per
// request. Route handlers run outside a render and get no memoization.

function userFromClaims(claims: Record<string, unknown> | null | undefined): User | null {
  if (!claims || typeof claims.sub !== "string") return null;
  const metadata = claims.user_metadata;
  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    email: typeof claims.email === "string" ? claims.email : undefined,
    phone: typeof claims.phone === "string" ? claims.phone : undefined,
    app_metadata: {},
    user_metadata: metadata && typeof metadata === "object" ? (metadata as User["user_metadata"]) : {},
    created_at: typeof claims.iat === "number" ? new Date(claims.iat * 1000).toISOString() : new Date(0).toISOString(),
  } as User;
}

/**
 * Local JWT check. The proxy already verified this request, so page renders
 * do not call the Auth server again. A missing email falls back to that call
 * so an invite can still be matched.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  try {
    const { headers } = await import("next/headers");
    const { enterBenchDiagFromHeaders } = await import("@/lib/bench-diag");
    await enterBenchDiagFromHeaders((await headers()).get("x-revupilot-bench-id"));
  } catch {
    /* outside a request or diag unavailable */
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const fromClaims = userFromClaims(data?.claims as Record<string, unknown> | undefined);
  if (fromClaims?.email) return fromClaims;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getUserConsent = cache(async (userId: string): Promise<boolean> => {
  const key = `consent:${userId}`;
  if (peek<boolean>(key) === true) return true;
  const agreed = await hasUserConsent(userId);
  if (agreed) put(key, true, 60_000);
  return agreed;
});

/** Signed-in user who has accepted the terms. Redirects otherwise. */
export const requireConsentedUser = cache(async (): Promise<User> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await getUserConsent(user.id))) redirect("/consent");
  return user;
});

export interface ActiveWorkspace {
  user: User;
  workspaceId: string;
}

/** Workspace id the super admin is support-viewing, or null. Read-only: proxy blocks mutations. */
export const getSupportTenantId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const { isSuperAdmin } = await import("@/lib/services/platform");
  if (!isSuperAdmin(user)) return null;
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get(SUPPORT_TENANT_COOKIE)?.value;
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
});

export const getActiveWorkspace = cache(async (): Promise<ActiveWorkspace> => {
  const user = await requireConsentedUser();
  const supportTenantId = await getSupportTenantId();
  if (supportTenantId) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data } = await admin.from("grm_workspaces").select("id, status").eq("id", supportTenantId).maybeSingle();
    if (data && data.status !== "deleted") return { user, workspaceId: supportTenantId };
  }
  const membership = await ensurePersonalWorkspace(user);
  return { user, workspaceId: membership.workspace_id };
});

export const getActiveRole = cache(async (): Promise<GrmMemberRole | null> => {
  const { user, workspaceId } = await getActiveWorkspace();
  return getMemberRole(user.id, workspaceId);
});
