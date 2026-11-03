import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { PageTabs } from "@/components/page-header";
import { SettingsAction, SettingsDetail, SettingsSection, SettingsValueRow } from "@/components/settings-section";
import { WorkspaceMembersCard } from "@/components/workspace-members-card";
import { ASSIGNABLE_ROLES, allows } from "@/lib/access";
import { listScopeChoices } from "@/lib/services/access";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { roleName, roleSummary } from "@/lib/ui/vocabulary";

const ROLE_ROWS = ["owner", ...ASSIGNABLE_ROLES] as const;

/** What each role covers. Display only. */
const ROLE_SCOPE: Record<string, string> = {
  owner: "Runs the workspace. Not reassigned here.",
  org_admin: "Manages people across the whole workspace.",
  brand_manager: "One business.",
  group_manager: "One group.",
  store_manager: "One location.",
  member: "Whatever scope they are given.",
};

type Params = Record<string, string | string[] | undefined>;

/** Settings › Team: who can open the workspace and what they can do. Was the /team page. */
export async function TeamSection({
  params,
  role,
  userId,
  workspaceId,
}: {
  params: Params;
  role: string | null;
  userId: string;
  workspaceId: string;
}) {
  const [roster, scopes] = await Promise.all([getWorkspaceRoster(workspaceId), listScopeChoices(workspaceId)]);
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
    const next = new URLSearchParams({ section: "team" });
    if (value !== "active") next.set("status", value);
    if (roleFilter && value !== "roles") next.set("role", roleFilter);
    return `/settings?${next.toString()}`;
  };
  const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

  return (
    <>
      <SettingsSection
        title="Team"
        description="People who can open this workspace and what they can do. A manager is limited to one business, one group, or one location."
        aside={canInvite ? <SettingsAction href="/settings?section=team&status=invited#invite">Invite</SettingsAction> : null}
      >
        <SettingsValueRow
          label="Members"
          hint={`People with access to ${roster.name}.`}
          value={plural(activeCount, "person", "people")}
          action={{ label: "View", href: `${tabHref("active")}#team-detail` }}
        />
        <SettingsValueRow
          label="Invitations"
          hint={emailDelivery ? "They join the next time they sign in with that Google address." : "No email is sent until a mail provider is configured. Copy each invite and share it."}
          value={roster.invites.length > 0 ? `${roster.invites.length.toLocaleString("en-US")} waiting` : "None waiting"}
          action={{ label: canInvite ? "Manage" : "View", href: `${tabHref("invited")}#team-detail` }}
        />
        {disabledCount > 0 ? (
          <SettingsValueRow
            label="Access off"
            hint="People kept on the team with their access turned off."
            value={plural(disabledCount, "person", "people")}
            action={{ label: "View", href: `${tabHref("inactive")}#team-detail` }}
          />
        ) : null}
        <SettingsValueRow
          label="Roles"
          hint="Roles are fixed. Scope limits what someone sees everywhere, including reports."
          value={`${ROLE_ROWS.length} roles`}
          action={{ label: "Compare", href: `${tabHref("roles")}#team-detail` }}
        />
      </SettingsSection>

      <SettingsDetail id="team-detail">
        <PageTabs
          tabs={[
            { label: "Members", href: tabHref("active"), active: status === "active", count: activeCount },
            { label: "Invitations", href: tabHref("invited"), active: status === "invited", count: roster.invites.length },
            { label: "Access off", href: tabHref("inactive"), active: status === "inactive", count: disabledCount, tone: "default" },
            { label: "Roles", href: tabHref("roles"), active: status === "roles" },
          ]}
        />
        {status === "roles" ? (
          <section className="overflow-hidden rounded-lg border border-line bg-white">
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
                    return (
                      <tr key={item} className="border-b border-line-2 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">{roleName(item)}</td>
                        <td className="px-3 py-2.5 text-ink-2">{roleSummary(item)}</td>
                        <td className="px-3 py-2.5 text-ink-3">{ROLE_SCOPE[item] ?? ""}</td>
                        <td className="px-3 py-2.5 text-center">
                          {allows(item, "manage_people") ? (
                            <Check className="mx-auto size-4 text-ok" aria-label="Yes" />
                          ) : (
                            <Minus className="mx-auto size-4 text-ink-3" aria-label="No" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {count > 0 ? (
                            <Link href={`/settings?section=team&role=${item}`} className="font-medium text-brand hover:text-brand-hover">
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
            currentUserId={userId}
            currentRole={role}
            members={members}
            invites={invites}
            scopes={scopes}
            emailDelivery={emailDelivery}
            view={status === "invited" ? "invites" : "members"}
            roleFilter={roleFilter}
          />
        )}
      </SettingsDetail>
    </>
  );
}
