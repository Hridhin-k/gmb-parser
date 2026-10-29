import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionLoading } from "@/components/section-loading";
import { WorkspaceMembersCard } from "@/components/workspace-members-card";
import { roleLabel } from "@/lib/access";
import { listScopeChoices } from "@/lib/services/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { canOpenPath } from "@/lib/shell";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/team", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const roleFilter = typeof params.role === "string" ? params.role : "";
  const status = params.status === "inactive" || params.status === "invited" ? params.status : "active";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team and roles"
        description="Owner, admin, managers, and members. A manager is limited to one brand, one group, or one location."
      >
        <Link
          href="/audit"
          className="inline-flex h-9 items-center rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
        >
          Audit log
        </Link>
      </PageHeader>
      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["active", "Active"],
            ["inactive", "Turned off"],
            ["invited", "Invited"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={value === "active" ? "/team" : `/team?status=${value}`}
            className={`rounded-full border px-3 py-1 ${status === value ? "border-ink bg-ink text-white" : "border-silver text-graphite"}`}
          >
            {label}
          </Link>
        ))}
        {roleFilter ? (
          <span className="rounded-full border border-silver px-3 py-1 text-slate">{roleLabel(roleFilter)}</span>
        ) : null}
      </div>
      <Suspense fallback={<SectionLoading page="team" variant="rows" />}>
        <TeamMembersSection
          userId={user.id}
          workspaceId={workspaceId}
          role={role}
          roleFilter={roleFilter}
          status={status}
        />
      </Suspense>
    </div>
  );
}

async function TeamMembersSection({
  userId,
  workspaceId,
  role,
  roleFilter,
  status,
}: {
  userId: string;
  workspaceId: string;
  role: Awaited<ReturnType<typeof getActiveRole>>;
  roleFilter: string;
  status: "active" | "inactive" | "invited";
}) {
  const [roster, scopes] = await Promise.all([
    getWorkspaceRoster(workspaceId),
    listScopeChoices(workspaceId),
  ]);
  const members = roster.members.filter((member) => {
    if (roleFilter && member.role !== roleFilter) return false;
    if (status === "inactive") return !member.accessEnabled;
    if (status === "invited") return false;
    return member.accessEnabled;
  });
  const invites =
    status === "active" || status === "inactive"
      ? []
      : roster.invites.filter((invite) => !roleFilter || invite.role === roleFilter);

  return (
    <WorkspaceMembersCard
      workspaceName={roster.name}
      currentUserId={userId}
      currentRole={role}
      members={status === "invited" ? [] : members}
      invites={status === "invited" ? invites : roster.invites}
      scopes={scopes}
      emailDelivery={Boolean(process.env.BREVO_API_KEY && process.env.REPORT_FROM_EMAIL)}
    />
  );
}
