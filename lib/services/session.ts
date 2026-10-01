import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { GrmMemberRole } from "@/lib/types";
import { hasUserConsent } from "./consent";
import { ensurePersonalWorkspace, getMemberRole } from "./workspace";

// Wrapped in React `cache` so a layout and its page share one lookup per
// request. Route handlers run outside a render and get no memoization.

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getUserConsent = cache(async (userId: string): Promise<boolean> =>
  hasUserConsent(userId)
);

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

export const getActiveWorkspace = cache(async (): Promise<ActiveWorkspace> => {
  const user = await requireConsentedUser();
  const membership = await ensurePersonalWorkspace(user);
  return { user, workspaceId: membership.workspace_id };
});

export const getActiveRole = cache(async (): Promise<GrmMemberRole | null> => {
  const { user, workspaceId } = await getActiveWorkspace();
  return getMemberRole(user.id, workspaceId);
});
