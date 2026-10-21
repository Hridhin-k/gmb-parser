import { roleLabel as labelForRole } from "@/lib/access";

/**
 * Whether `actorRole` may change or remove someone holding `targetRole`.
 * The owner cannot be changed. An admin manages admins, managers, and members.
 */
export function canManageMember(
  actorRole: string | null | undefined,
  targetRole: string
): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner" || actorRole === "org_admin" || actorRole === "admin") return true;
  return false;
}

export function roleLabel(role: string): string {
  return labelForRole(role);
}
