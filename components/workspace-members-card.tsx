"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, Copy, LogOut, MoreHorizontal, Power, RefreshCw, Search, UserMinus, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ASSIGNABLE_ROLES, allows } from "@/lib/access";
import { canManageMember } from "@/lib/roles";
import { roleName, roleSummary } from "@/lib/ui/vocabulary";
import { cn } from "@/lib/utils";

interface MemberRow {
  userId: string;
  email: string;
  role: string;
  joinedAt?: string;
  accessEnabled?: boolean;
  scopeLabel?: string;
  alertEmail?: boolean;
  alertInApp?: boolean;
  twoStep?: "on" | "off" | "unavailable";
  lastActive?: string | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  scopeLabel?: string;
}

interface ScopeChoice {
  id: string;
  label: string;
  kind: "client" | "group" | "location";
}

interface WorkspaceMembersCardProps {
  workspaceName: string;
  currentUserId: string;
  currentRole: string | null;
  members: MemberRow[];
  invites: InviteRow[];
  scopes?: ScopeChoice[];
  emailDelivery?: boolean;
  /** Which list to show. "members" also covers the disabled tab. */
  view?: "members" | "invites";
  /** Current `role` filter from the URL. */
  roleFilter?: string;
}

type PendingConfirm =
  | { kind: "remove"; member: MemberRow }
  | { kind: "leave" }
  | { kind: "disable"; member: MemberRow }
  | null;

async function send(method: string, url: string, body: object) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function initials(email: string) {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[.\s_+-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FILTER_ROLES = ["owner", ...ASSIGNABLE_ROLES] as const;

export function WorkspaceMembersCard({
  workspaceName,
  currentUserId,
  currentRole,
  members,
  invites,
  scopes = [],
  emailDelivery = false,
  view = "members",
  roleFilter = "",
}: WorkspaceMembersCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canInvite = allows(currentRole, "manage_people") || currentRole === "admin";
  const isOwner = allows(currentRole, "manage_people");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [scopeId, setScopeId] = useState("organization");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [query, setQuery] = useState("");
  // Read the clock once per mount for the "expires soon" hint.
  const [now] = useState(() => Date.now());

  const needle = query.trim().toLowerCase();
  const visibleMembers = useMemo(
    () =>
      needle
        ? members.filter(
            (member) =>
              member.email.toLowerCase().includes(needle) ||
              (member.scopeLabel ?? "").toLowerCase().includes(needle) ||
              roleName(member.role).toLowerCase().includes(needle)
          )
        : members,
    [members, needle]
  );
  const visibleInvites = useMemo(
    () => (needle ? invites.filter((invite) => invite.email.toLowerCase().includes(needle)) : invites),
    [invites, needle]
  );

  function setRoleFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("role", next);
    else params.delete("role");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInviting(true);
    try {
      const choice = scopes.find((item) => item.id === scopeId);
      await send("POST", "/api/workspace/invites", {
        email,
        role: isOwner ? role : "member",
        clientId: choice?.kind === "client" ? choice.id : null,
        groupId: choice?.kind === "group" ? choice.id : null,
        locationId: choice?.kind === "location" ? choice.id : null,
      });
      toast.success(`Invite saved for ${email}`, {
        description: emailDelivery
          ? "Copy the invite message and send it to them."
          : "No email is sent until a mail provider is configured. Copy the invite and share it.",
      });
      setEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invite.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setError(null);
    setBusyId(inviteId);
    try {
      await send("DELETE", "/api/workspace/invites", { inviteId });
      toast.success("Invite cancelled");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the invite.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRoleChange(member: MemberRow, nextRole: string) {
    if (!nextRole || nextRole === member.role) return;
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(nextRole)) return;
    setError(null);
    setBusyId(member.userId);
    try {
      await send("PATCH", "/api/workspace/members", { userId: member.userId, role: nextRole });
      toast.success(`${member.email} is now ${roleName(nextRole)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the role.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(member: MemberRow) {
    setError(null);
    try {
      await send("DELETE", "/api/workspace/members", { userId: member.userId });
      toast.success(`${member.email} was removed`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that person.");
    }
  }

  async function handleLeave() {
    setError(null);
    try {
      await send("DELETE", "/api/workspace/members", { userId: currentUserId });
      toast.success(`You left ${workspaceName}`);
      router.replace("/overview");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave the workspace.");
    }
  }

  async function setAccess(member: MemberRow, enabled: boolean) {
    setError(null);
    setBusyId(member.userId);
    try {
      await send("PATCH", "/api/workspace/members", { userId: member.userId, accessEnabled: enabled });
      toast.success(enabled ? "Access turned on" : "Access turned off");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change access.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleEmailAlerts(member: MemberRow) {
    setBusyId(member.userId);
    send("PATCH", "/api/workspace/members", {
      userId: member.userId,
      alertEmail: !member.alertEmail,
      alertInApp: member.alertInApp !== false,
    })
      .then(() => {
        toast.success(member.alertEmail ? "Email alerts turned off" : "Email alerts saved", {
          description: emailDelivery
            ? undefined
            : "The preference is saved. Mail is not delivered until a mail provider is configured.",
        });
        router.refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not save alerts."))
      .finally(() => setBusyId(null));
  }

  async function copyInvite(invite: InviteRow) {
    const message = [
      `You're invited to the "${workspaceName}" workspace on RevuPilot as ${roleName(invite.role)}.`,
      "",
      `Sign in with Google using ${invite.email}:`,
      `${window.location.origin}/login`,
      "",
      invite.expiresAt
        ? `This invite expires on ${new Date(invite.expiresAt).toLocaleDateString()}. No email is sent automatically.`
        : "No email is sent automatically.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Invite message copied", {
        description: "Paste it into an email, Slack, or WhatsApp.",
      });
    } catch {
      toast.error("Could not copy. Share the login link manually.");
    }
  }

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === "invites" ? "Search invitations" : "Search people, roles, scope"}
            aria-label={view === "invites" ? "Search invitations" : "Search people"}
            className="h-8 w-full pl-8 sm:w-60"
          />
        </div>
        <SelectField
          label="Filter by role"
          size="sm"
          value={roleFilter}
          className="w-auto"
          onValueChange={setRoleFilter}
          options={[{ value: "", label: "All roles" }, ...FILTER_ROLES.map((item) => ({ value: item, label: roleName(item) }))]}
        />
      </div>
      <span className="text-xs text-ink-3">
        {view === "invites"
          ? `${visibleInvites.length} of ${invites.length} ${invites.length === 1 ? "invitation" : "invitations"}`
          : `${visibleMembers.length} of ${members.length} ${members.length === 1 ? "person" : "people"}`}
      </span>
    </div>
  );

  const clearFilters =
    needle || roleFilter ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setQuery("");
          if (roleFilter) setRoleFilter("");
        }}
      >
        Clear filters
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Banner tone="bad">{error}</Banner> : null}

      {view === "invites" ? (
        <>
          {canInvite ? (
            <section id="invite" className="scroll-mt-20 rounded-lg border border-line bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <UserPlus className="size-4 text-ink-3" aria-hidden />
                Invite people
              </h2>
              <p className="mt-1 text-xs text-ink-3">
                People only see what sits below the place you pick. The invite expires in 14 days and is accepted the next time that email
                signs in with Google.
                {emailDelivery
                  ? " Email delivery is configured."
                  : " Email is not sent until a mail provider is configured, so copy the invite and share it."}{" "}
                WhatsApp alerts are not available.
              </p>
              <form onSubmit={handleInvite} className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-start">
                <Input
                  id="invite-email"
                  type="text"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  aria-label="Email or mobile number"
                  className="lg:flex-1"
                />
                {isOwner ? (
                  <div className="flex flex-col gap-1 lg:w-52">
                    <SelectField
                      id="invite-role"
                      label="Role"
                      value={role}
                      onValueChange={setRole}
                      options={ASSIGNABLE_ROLES.map((item) => ({ value: item, label: roleName(item) }))}
                    />
                    <span className="text-xs text-ink-3">{roleSummary(role)}</span>
                  </div>
                ) : null}
                {isOwner ? (
                  <SelectField
                    id="invite-scope"
                    label="Can see"
                    value={scopeId}
                    className="lg:w-56"
                    onValueChange={setScopeId}
                    options={[
                      { value: "organization", label: "Whole workspace" },
                      ...scopes.map((item) => ({ value: item.id, label: item.label })),
                    ]}
                  />
                ) : null}
                <Button type="submit" loading={inviting}>
                  <UserPlus aria-hidden />
                  {inviting ? "Inviting…" : "Send invite"}
                </Button>
              </form>
              {!isOwner ? (
                <p className="mt-2 text-xs text-ink-3">Admins invite people as {roleName("member")}. An owner can choose another role and scope.</p>
              ) : null}
            </section>
          ) : (
            <Banner tone="neutral">An owner or admin can invite people and change roles.</Banner>
          )}

          <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
            {invites.length > 0 ? toolbar : null}
            {invites.length === 0 ? (
              <EmptyState
                bare
                icon={UserPlus}
                title={roleFilter ? "No invitations for this role" : "No pending invitations"}
                description={
                  roleFilter
                    ? "Clear the role filter to see every pending invitation."
                    : "Invitations you create appear here until the person signs in or the invite expires."
                }
              >
                {clearFilters}
              </EmptyState>
            ) : visibleInvites.length === 0 ? (
              <EmptyState bare icon={Search} title="No invitations match" description="Try another email address.">
                {clearFilters}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-[13px]">
                  <thead className="bg-[#fafbfc] text-xs text-ink-3">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 font-medium">Invited</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Scope</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvites.map((invite) => {
                      const expires = invite.expiresAt ? new Date(invite.expiresAt) : null;
                      const soon = expires ? expires.getTime() - now < 2 * 24 * 60 * 60 * 1000 : false;
                      return (
                        <tr key={invite.id} className="border-b border-line-2 last:border-0 hover:bg-[#fafbfd]">
                          <td className="px-3 py-2.5">
                            <span className="font-medium text-ink">{invite.email}</span>
                            {invite.createdAt ? <span className="block text-xs text-ink-3">Invited {shortDate(invite.createdAt)}</span> : null}
                          </td>
                          <td className="px-3 py-2.5 text-ink-2" title={roleSummary(invite.role)}>
                            {roleName(invite.role)}
                          </td>
                          <td className="px-3 py-2.5 text-ink-2">{invite.scopeLabel ?? "Whole workspace"}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant={soon ? "warn" : "info"}>{soon ? "Expires soon" : "Pending"}</Badge>
                            {expires ? <span className="mt-0.5 block text-xs text-ink-3">Expires {expires.toLocaleDateString()}</span> : null}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {canInvite ? (
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button type="button" variant="outline" size="sm" onClick={() => copyInvite(invite)}>
                                  <Copy aria-hidden />
                                  Copy invite
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  loading={busyId === `resend-${invite.id}`}
                                  title="Extends the invite. No email is sent."
                                  onClick={() => {
                                    setBusyId(`resend-${invite.id}`);
                                    send("PATCH", "/api/workspace/invites", { inviteId: invite.id })
                                      .then(() => {
                                        toast.success("Invite refreshed", {
                                          description: "No email was sent. Copy the invite and share it.",
                                        });
                                        router.refresh();
                                      })
                                      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not resend."))
                                      .finally(() => setBusyId(null));
                                  }}
                                >
                                  <RefreshCw aria-hidden />
                                  Resend
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-bad hover:bg-bad-tint hover:text-bad"
                                  loading={busyId === invite.id}
                                  onClick={() => handleRevoke(invite.id)}
                                >
                                  <X aria-hidden />
                                  {busyId === invite.id ? "Cancelling…" : "Cancel"}
                                </Button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {invites.length > 0 ? (
              <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
                {emailDelivery
                  ? "Bounced or undelivered invitation emails are not reported here yet. If someone didn’t get it, copy the invite and send it another way."
                  : "RevuPilot doesn’t email invitations for you yet, so use Copy invite to share each one."}
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
          {toolbar}
          {members.length === 0 ? (
            <EmptyState
              bare
              icon={UserMinus}
              title={roleFilter ? "Nobody has this role" : "No one here"}
              description={roleFilter ? "Clear the role filter to see everyone." : "People appear here when their access matches this tab."}
            >
              {clearFilters}
            </EmptyState>
          ) : visibleMembers.length === 0 ? (
            <EmptyState bare icon={Search} title="No people match" description="Try another name, role or scope.">
              {clearFilters}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-[13px]">
                <thead className="bg-[#fafbfc] text-xs text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Scope</th>
                    <th className="px-3 py-2 font-medium">Alerts</th>
                    <th className="px-3 py-2 font-medium">Two-step</th>
                    <th className="px-3 py-2 font-medium">Last active</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMembers.map((member) => {
                    const isSelf = member.userId === currentUserId;
                    const manageable = !isSelf && canManageMember(currentRole, member.role);
                    const disabled = member.accessEnabled === false;
                    const busy = busyId === member.userId;
                    const alerts =
                      member.alertInApp === false && !member.alertEmail
                        ? "No alerts"
                        : [member.alertInApp !== false ? "In app" : null, member.alertEmail ? "Email" : null].filter(Boolean).join(", ");
                    const hasMenu = isOwner || isSelf || manageable;
                    return (
                      <tr
                        key={member.userId}
                        className={cn("border-b border-line-2 last:border-0 hover:bg-[#fafbfd]", disabled && "text-ink-3")}
                      >
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                                disabled ? "bg-paper text-ink-3" : "bg-[#dde3ee] text-ink-2"
                              )}
                              aria-hidden
                            >
                              {initials(member.email)}
                            </span>
                            <span className="min-w-0">
                              <span className={cn("block truncate font-medium", disabled ? "text-ink-3" : "text-ink")}>
                                {member.email}
                                {isSelf ? <span className="ml-1.5 text-xs font-normal text-ink-3">You</span> : null}
                              </span>
                              {member.joinedAt ? <span className="block text-xs text-ink-3">Joined {shortDate(member.joinedAt)}</span> : null}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {manageable && isOwner ? (
                            <SelectField
                              label={`Role for ${member.email}`}
                              value={member.role}
                              size="sm"
                              disabled={busy}
                              className="w-48"
                              onValueChange={(next) => handleRoleChange(member, next)}
                              options={[
                                ...((ASSIGNABLE_ROLES as readonly string[]).includes(member.role)
                                  ? []
                                  : [{ value: member.role, label: roleName(member.role) }]),
                                ...ASSIGNABLE_ROLES.map((item) => ({ value: item, label: roleName(item) })),
                              ]}
                            />
                          ) : (
                            <span className="text-ink-2" title={roleSummary(member.role)}>
                              {roleName(member.role)}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-2.5 text-ink-2">{member.scopeLabel ?? "Whole workspace"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-2">{alerts}</td>
                        <td className="px-3 py-2.5">
                          {member.twoStep === "on" ? (
                            <Badge variant="ok">On</Badge>
                          ) : member.twoStep === "off" ? (
                            <Badge variant="warn">Off</Badge>
                          ) : (
                            <span className="text-xs text-ink-3">Not available</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-2">
                          {member.lastActive ? shortDate(member.lastActive) : <span className="text-ink-3">Not available</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {disabled ? <Badge variant="bad">Access off</Badge> : <Badge variant="ok">Active</Badge>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {disabled && manageable && isOwner ? (
                              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void setAccess(member, true)}>
                                Re-enable
                              </Button>
                            ) : null}
                            {hasMenu ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${member.email}`} />}
                                  disabled={busy}
                                >
                                  <MoreHorizontal aria-hidden />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  {isOwner || isSelf ? (
                                    <DropdownMenuItem onClick={() => toggleEmailAlerts(member)}>
                                      {member.alertEmail ? <BellOff aria-hidden /> : <Bell aria-hidden />}
                                      {member.alertEmail ? "Turn off email alerts" : "Turn on email alerts"}
                                    </DropdownMenuItem>
                                  ) : null}
                                  {manageable && isOwner ? (
                                    <DropdownMenuItem
                                      onClick={() => (disabled ? void setAccess(member, true) : setConfirm({ kind: "disable", member }))}
                                    >
                                      <Power aria-hidden />
                                      {disabled ? "Turn access on" : "Turn access off"}
                                    </DropdownMenuItem>
                                  ) : null}
                                  {manageable ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: "remove", member })}>
                                        <UserMinus aria-hidden />
                                        Remove from workspace
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                  {isSelf && member.role !== "owner" ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: "leave" })}>
                                        <LogOut aria-hidden />
                                        Leave workspace
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
            {canInvite
              ? "Owners change roles and turn access on or off. Turning access off keeps a person’s history; removing them ends access right away."
              : "An owner or admin can invite people and change roles."}
          </p>
        </section>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === "leave"
            ? `Leave ${workspaceName}?`
            : confirm?.kind === "disable"
              ? "Turn off access?"
              : "Remove from workspace?"
        }
        description={
          confirm?.kind === "remove" ? (
            <>
              <span className="font-medium text-ink">{confirm.member.email}</span> loses access to this workspace&apos;s businesses, reviews,
              and Google accounts right away. You can invite them again later.
            </>
          ) : confirm?.kind === "disable" ? (
            <>
              <span className="font-medium text-ink">{confirm.member.email}</span> can’t sign in to this workspace until access is turned
              back on. Their history stays.
            </>
          ) : (
            "You lose access to this workspace's businesses and reviews. An owner or admin can invite you back."
          )
        }
        confirmLabel={confirm?.kind === "leave" ? "Leave workspace" : confirm?.kind === "disable" ? "Turn off access" : "Remove"}
        pendingLabel={confirm?.kind === "leave" ? "Leaving…" : confirm?.kind === "disable" ? "Turning off…" : "Removing…"}
        tone="danger"
        onConfirm={async () => {
          if (confirm?.kind === "remove") await handleRemove(confirm.member);
          else if (confirm?.kind === "disable") await setAccess(confirm.member, false);
          else if (confirm?.kind === "leave") await handleLeave();
        }}
      />
    </div>
  );
}
