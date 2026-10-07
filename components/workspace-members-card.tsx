"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, LogOut, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canManageMember, roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

interface MemberRow {
  userId: string;
  email: string;
  role: string;
  joinedAt?: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
}

interface WorkspaceMembersCardProps {
  workspaceName: string;
  currentUserId: string;
  currentRole: string | null;
  members: MemberRow[];
  invites: InviteRow[];
}

type PendingConfirm =
  | { kind: "remove"; member: MemberRow }
  | { kind: "leave" }
  | null;

const FIELD =
  "h-10 rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe]";

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

function joinedLabel(iso?: string) {
  if (!iso) return null;
  return `Joined ${new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function WorkspaceMembersCard({
  workspaceName,
  currentUserId,
  currentRole,
  members,
  invites,
}: WorkspaceMembersCardProps) {
  const router = useRouter();
  const canInvite = currentRole === "owner" || currentRole === "admin";
  const isOwner = currentRole === "owner";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInviting(true);
    try {
      await send("POST", "/api/workspace/invites", { email, role });
      toast.success(`Invite saved for ${email}`, {
        description: "Copy the invite message and send it to them.",
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

  async function handleRoleChange(member: MemberRow, nextRole: "admin" | "member") {
    setError(null);
    setBusyId(member.userId);
    try {
      await send("PATCH", "/api/workspace/members", { userId: member.userId, role: nextRole });
      toast.success(`${member.email} is now ${nextRole === "admin" ? "an admin" : "a member"}`);
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
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave the workspace.");
    }
  }

  async function copyInvite(invite: InviteRow) {
    const message = [
      `You're invited to the "${workspaceName}" workspace on GRM as ${
        invite.role === "admin" ? "an admin" : "a member"
      }.`,
      "",
      `Sign in with Google using ${invite.email}:`,
      `${window.location.origin}/login`,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle
          className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#202124]"
          style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
        >
          Team
        </CardTitle>
        <p className="mt-1 text-sm font-light text-[#5f6368]">
          {workspaceName} · {members.length} {members.length === 1 ? "person" : "people"}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="divide-y divide-[#f8f9fa] overflow-hidden rounded-2xl border border-[#dadce0]">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const manageable = !isSelf && canManageMember(currentRole, member.role);
            return (
              <li
                key={member.userId}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#202124]">
                    {member.email}
                    {isSelf ? (
                      <span className="ml-2 text-xs font-normal text-[#5f6368]">You</span>
                    ) : null}
                  </p>
                  {joinedLabel(member.joinedAt) ? (
                    <p className="text-xs text-[#5f6368]">{joinedLabel(member.joinedAt)}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {manageable && isOwner ? (
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busyId === member.userId}
                      onChange={(e) =>
                        handleRoleChange(member, e.target.value as "admin" | "member")
                      }
                      className={cn(FIELD, "h-8 px-3 text-xs")}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        member.role === "owner"
                          ? "bg-[#202124] text-white"
                          : member.role === "admin"
                            ? "bg-[#e8f0fe] text-[#1a73e8]"
                            : "bg-[#f8f9fa] text-[#3c4043]"
                      )}
                    >
                      {roleLabel(member.role)}
                    </span>
                  )}
                  {manageable ? (
                    <button
                      type="button"
                      onClick={() => setConfirm({ kind: "remove", member })}
                      className="rounded-full p-2 text-[#5f6368] hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${member.email}`}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                  {isSelf && member.role !== "owner" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setConfirm({ kind: "leave" })}
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden />
                      Leave
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {invites.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6368]">
              Pending invites
            </p>
            <ul className="divide-y divide-[#f8f9fa] overflow-hidden rounded-2xl border border-[#dadce0]">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="truncate text-sm text-[#202124]">
                    {invite.email}
                    <span className="ml-2 text-xs text-[#5f6368]">{roleLabel(invite.role)}</span>
                  </p>
                  {canInvite ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => copyInvite(invite)}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                        Copy invite
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === invite.id}
                        onClick={() => handleRevoke(invite.id)}
                      >
                        {busyId === invite.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canInvite ? (
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="invite-email">
                Email address
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                className={cn(FIELD, "w-full")}
              />
              {isOwner ? (
                <>
                  <label className="sr-only" htmlFor="invite-role">
                    Role
                  </label>
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as "member" | "admin")}
                    className={FIELD}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </>
              ) : null}
              <Button type="submit" disabled={inviting}>
                {inviting ? "Inviting…" : "Invite"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-[#5f6368]">
              They join this workspace the next time they sign in with that Google address. GRM
              does not send the email for you, so use Copy invite to share it.
            </p>
          </form>
        ) : (
          <p className="text-xs text-[#5f6368]">
            An owner or admin can invite people and change roles.
          </p>
        )}

        <div className="rounded-2xl bg-[#f8f9fa] px-4 py-3 text-xs leading-relaxed text-[#3c4043]">
          <span className="font-semibold text-[#202124]">Owner</span> manages everyone.{" "}
          <span className="font-semibold text-[#202124]">Admins</span> approve replies and manage
          members. <span className="font-semibold text-[#202124]">Members</span> draft replies and
          publish approved ones.
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.kind === "leave" ? `Leave ${workspaceName}?` : "Remove from workspace?"}
        description={
          confirm?.kind === "remove" ? (
            <>
              <span className="font-medium text-[#202124]">{confirm.member.email}</span> loses
              access to this workspace&apos;s clients, reviews, and Google accounts right away. You
              can invite them again later.
            </>
          ) : (
            "You lose access to this workspace's clients and reviews. An owner or admin can invite you back."
          )
        }
        confirmLabel={confirm?.kind === "leave" ? "Leave workspace" : "Remove"}
        pendingLabel={confirm?.kind === "leave" ? "Leaving…" : "Removing…"}
        tone="danger"
        onConfirm={async () => {
          if (confirm?.kind === "remove") await handleRemove(confirm.member);
          else if (confirm?.kind === "leave") await handleLeave();
        }}
      />
    </Card>
  );
}
