import { notFound } from "next/navigation";
import { EscalationTicket } from "@/components/escalation-ticket";
import { TransitionScope } from "@/components/transition-scope";
import { canReceiveEscalation, canReassignEscalation, formatInTimezone, slaClock } from "@/lib/escalations";
import { EscalationContactStore, EscalationService } from "@/lib/services/escalations";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canApproveReplies, getWorkspaceRoster } from "@/lib/services/workspace";
import { draftsWithAiOnly } from "@/lib/access";

export default async function EscalationCasePage({
  params,
}: {
  params: Promise<{ escalationId: string }>;
}) {
  const { escalationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(escalationId)) notFound();
  const [{ workspaceId }, role] = await Promise.all([getActiveWorkspace(), getActiveRole()]);
  await EscalationService.settleOpenAssignments(workspaceId, escalationId);
  const [item, policy, contact, roster] = await Promise.all([
    EscalationService.get(workspaceId, escalationId),
    EscalationService.policy(workspaceId),
    EscalationContactStore.read(workspaceId),
    getWorkspaceRoster(workspaceId),
  ]);
  if (!item) notFound();
  const place = {
    workspaceId,
    clientId: item.clientId,
    groupId: item.groupId ?? null,
    parentGroupId: item.parentGroupId ?? null,
    locationId: item.locationId,
  };
  const stamped = {
    ...item,
    ...slaClock(item.dueAt, Date.now()),
    dueLabel: formatInTimezone(item.dueAt, policy.timezone),
  };

  return (
    <TransitionScope>
      <div className="mt-2">
        <EscalationTicket
          item={stamped}
          contact={contact}
          canManage={canApproveReplies(role)}
          aiOnly={draftsWithAiOnly(role)}
          canReassign={canReassignEscalation(role)}
          members={roster.members
            .filter((member) => member.accessEnabled)
            .map((member) => ({
              userId: member.userId,
              email: member.email,
              role: member.role,
              scopeLabel: member.scopeLabel,
            }))}
          assignees={roster.members
            .filter(
              (member) =>
                member.accessEnabled &&
                canReceiveEscalation(
                  { userId: member.userId, role: member.role, enabled: true, scope: member.scope },
                  place
                )
            )
            .map((member) => member.userId)}
        />
      </div>
    </TransitionScope>
  );
}
