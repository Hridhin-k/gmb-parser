"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MemberRow {
  userId: string;
  email: string;
  role: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
}

interface WorkspaceMembersCardProps {
  workspaceName: string;
  currentUserId: string;
  canInvite: boolean;
  members: MemberRow[];
  invites: InviteRow[];
}

function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export function WorkspaceMembersCard({
  workspaceName,
  currentUserId,
  canInvite,
  members,
  invites,
}: WorkspaceMembersCardProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const response = await fetch("/api/workspace/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not create the invite.");
        return;
      }
      setEmail("");
      setSuccess(
        "Invite saved. They join this workspace the next time they sign in with that email."
      );
      router.refresh();
    } catch {
      setError("Could not create the invite.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setError(null);
    setSuccess(null);
    setRevoking(inviteId);
    try {
      const response = await fetch("/api/workspace/invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not cancel the invite.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not cancel the invite.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle
          className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#18161a]"
          style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
        >
          Workspace
        </CardTitle>
        <p className="mt-1 text-sm font-light text-[#898b91]">{workspaceName}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="divide-y divide-[#f3f1ee] rounded-md border border-[#e4e2de]">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="truncate text-sm text-[#18161a]">
                {member.email}
                {member.userId === currentUserId ? (
                  <span className="ml-2 text-xs text-[#898b91]">You</span>
                ) : null}
              </span>
              <Badge variant="secondary" className="shrink-0">
                {roleLabel(member.role)}
              </Badge>
            </li>
          ))}
        </ul>

        {invites.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#898b91]">Pending invites</p>
            <ul className="divide-y divide-[#f3f1ee] rounded-md border border-[#e4e2de]">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="truncate text-sm text-[#18161a]">
                    {invite.email}
                    <span className="ml-2 text-xs text-[#898b91]">{roleLabel(invite.role)}</span>
                  </span>
                  {canInvite ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={revoking === invite.id}
                      onClick={() => handleRevoke(invite.id)}
                    >
                      {revoking === invite.id ? "Cancelling…" : "Cancel"}
                    </Button>
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
                className="w-full rounded-md border border-[#e4e2de] px-3 py-2 text-sm shadow-sm focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
              />
              <label className="sr-only" htmlFor="invite-role">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as "member" | "admin")}
                className="rounded-md border border-[#e4e2de] px-3 py-2 text-sm shadow-sm focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={loading}>
                {loading ? "Inviting…" : "Invite"}
              </Button>
            </div>
            <p className="text-xs text-[#898b91]">
              No email is sent. The next time they sign in with this Google address, they open
              this workspace and see its clients, locations, reviews, and connected Google accounts.
            </p>
          </form>
        ) : (
          <p className="text-xs text-[#898b91]">
            You can see everyone in this workspace. An owner or admin can invite someone else.
          </p>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      </CardContent>
    </Card>
  );
}
