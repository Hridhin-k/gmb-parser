import { roleLabel as labelForRole } from "@/lib/access";

/**
 * Whether `actorRole` may change or remove someone holding `targetRole`.
 * The organization owner cannot be changed. Organization admins manage everyone else.
 * A legacy admin manages members only.
 */
export function canManageMember(
  actorRole: string | null | undefined,
  targetRole: string
): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner" || actorRole === "org_admin") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

export function roleLabel(role: string): string {
  return labelForRole(role);
}
