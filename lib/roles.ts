import type { GrmMemberRole } from "@/lib/types";

/**
 * Whether `actorRole` may change or remove someone holding `targetRole`.
 * Owners manage everyone else. Admins manage members only. Nobody manages an owner.
 */
export function canManageMember(
  actorRole: GrmMemberRole | string | null | undefined,
  targetRole: GrmMemberRole | string
): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

export function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}
