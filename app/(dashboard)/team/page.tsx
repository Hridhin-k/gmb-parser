import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Minus, UserPlus } from "lucide-react";
import { PageHeader, PageTabs } from "@/components/page-header";
import { WorkspaceMembersCard } from "@/components/workspace-members-card";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ASSIGNABLE_ROLES, allows } from "@/lib/access";
import { listScopeChoices } from "@/lib/services/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { canOpenPath } from "@/lib/shell";
import { roleName, roleSummary } from "@/lib/ui/vocabulary";

const ROLE_ROWS = ["owner", ...ASSIGNABLE_ROLES] as const;

/** What each role covers, as described on the old team page. Display only. */
const ROLE_SCOPE: Record<string, string> = {
  owner: "Runs the workspace. Not reassigned here.",
  org_admin: "Manages people across the whole workspace.",
  brand_manager: "One business.",
  group_manager: "One group.",
  store_manager: "One location.",
  member: "Whatever scope they are given.",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/team", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const [roster, scopes] = await Promise.all([
    getWorkspaceRoster(workspaceId),
    listScopeChoices(workspaceId),
  ]);
  const roleFilter = typeof params.role === "string" ? params.role : "";
  const status =
    params.status === "inactive" || params.status === "invited" || params.status === "roles" ? params.status : "active";
  const members = roster.members.filter((member) => {
    if (roleFilter && member.role !== roleFilter) return false;
    if (status === "inactive") return !member.accessEnabled;
    if (status === "invited" || status === "roles") return false;
    return member.accessEnabled;
  });
  const invites = roster.invites.filter((invite) => !roleFilter || invite.role === roleFilter);
  const activeCount = roster.members.filter((member) => member.accessEnabled).length;
  const disabledCount = roster.members.length - activeCount;
  const canInvite = allows(role, "manage_people") || role === "admin";
  const emailDelivery = Boolean(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL);
  const tabHref = (value: string) => {
    const next = new URLSearchParams();
    if (value !== "active") next.set("status", value);
    if (roleFilter && value !== "roles") next.set("role", roleFilter);
    const query = next.toString();
    return query ? `/team?${query}` : "/team";
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team"
        description={`${roster.name} · ${activeCount} ${activeCount === 1 ? "member" : "members"} · ${roster.invites.length} pending ${roster.invites.length === 1 ? "invitation" : "invitations"}${disabledCount > 0 ? ` · ${disabledCount} with access off` : ""}. A manager is limited to one business, one group, or one location.`}
      >
        <Button variant="outline" nativeButton={false} render={<Link href="/audit" />}>
          Audit log
        </Button>
        {canInvite ? (
          <Button nativeButton={false} render={<Link href="/team?status=invited#invite" />}>
            <UserPlus aria-hidden />
            Invite people
          </Button>
        ) : null}
      </PageHeader>

      <PageTabs
        tabs={[
          { label: "Members", href: tabHref("active"), active: status === "active", count: activeCount },
          { label: "Invitations", href: tabHref("invited"), active: status === "invited", count: roster.invites.length },
          { label: "Access off", href: tabHref("inactive"), active: status === "inactive", count: disabledCount, tone: "default" },
          { label: "Roles", href: tabHref("roles"), active: status === "roles" },
        ]}
      />

      {status === "active" && roster.invites.length > 0 && canInvite ? (
        <Banner
          tone="info"
          title={`${roster.invites.length} ${roster.invites.length === 1 ? "invitation is" : "invitations are"} waiting.`}
          actions={
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={tabHref("invited")} />}>
              View invitations
            </Button>
          }
        >
          {emailDelivery
            ? "They join the next time they sign in with that Google address."
            : "No email is sent until a mail provider is configured, so copy each invite and share it."}
        </Banner>
      ) : null}

      {status === "roles" ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Roles</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Roles are fixed. Scope limits what someone sees everywhere, including reports. Custom roles are not available yet.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[13px]">
              <thead className="bg-[#fafbfc] text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">What they can do</th>
                  <th className="px-3 py-2 font-medium">Covers</th>
                  <th className="px-3 py-2 text-center font-medium">Invite people</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_ROWS.map((item) => {
                  const count = roster.members.filter((member) => member.role === item && member.accessEnabled).length;
                  const invitesPeople = allows(item, "manage_people");
                  return (
                    <tr key={item} className="border-b border-line-2 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">{roleName(item)}</td>
                      <td className="px-3 py-2.5 text-ink-2">{roleSummary(item)}</td>
                      <td className="px-3 py-2.5 text-ink-3">{ROLE_SCOPE[item] ?? ""}</td>
                      <td className="px-3 py-2.5 text-center">
                        {invitesPeople ? (
                          <Check className="mx-auto size-4 text-ok" aria-label="Yes" />
                        ) : (
                          <Minus className="mx-auto size-4 text-ink-3" aria-label="No" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {count > 0 ? (
                          <Link href={`/team?role=${item}`} className="font-medium text-brand hover:text-brand-hover">
                            {count}
                          </Link>
                        ) : (
                          <span className="text-ink-3">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <WorkspaceMembersCard
          workspaceName={roster.name}
          currentUserId={user.id}
          currentRole={role}
          members={members}
          invites={invites}
          scopes={scopes}
          emailDelivery={emailDelivery}
          view={status === "invited" ? "invites" : "members"}
          roleFilter={roleFilter}
        />
      )}
    </div>
  );
}
