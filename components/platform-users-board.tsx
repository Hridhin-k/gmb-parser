"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationBar } from "@/components/pagination-bar";
import type { GlobalUserRow } from "@/lib/services/platform";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
}

export function PlatformUsersBoard({ users, initialQuery, total, page, pageSize }: { users: GlobalUserRow[]; initialQuery: string; total: number; page: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const searchParams = new URLSearchParams();
  if (initialQuery) searchParams.set("q", initialQuery);
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(user: GlobalUserRow) {
    setBusy(user.userId);
    setError(null);
    try {
      await send("/api/platform/users", { email: user.email, blocked: !user.blocked, reason: user.blocked ? null : "Blocked from super admin" });
      toast.success(user.blocked ? `${user.email} unblocked` : `${user.email} blocked platform-wide`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that user.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); router.replace(`/admin/users${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`); }} className="flex gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email…" aria-label="Search users" className="sm:max-w-sm" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <ul className="divide-y divide-silver overflow-hidden rounded-xl border border-silver bg-white">
        {users.map((user) => (
          <li key={user.userId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-graphite">{user.email}{user.blocked ? <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">blocked</span> : null}</p>
              <p className="text-xs text-slate">
                {user.memberships.length === 0 ? "No tenant membership" : user.memberships.map((m) => `${m.tenantName} (${m.role}${m.tenantStatus !== "active" ? `, ${m.tenantStatus}` : ""})`).join(" · ")}
                {user.lastSignInAt ? ` · last sign-in ${new Date(user.lastSignInAt).toLocaleDateString()}` : " · never signed in"}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" loading={busy === user.userId} onClick={() => toggle(user)}>{user.blocked ? "Unblock" : "Block"}</Button>
          </li>
        ))}
        {users.length === 0 ? <li className="px-4 py-3 text-sm text-slate">No users match.</li> : null}
      </ul>
      <p className="text-xs text-slate">{total} user{total === 1 ? "" : "s"} total</p>
      {totalPages > 1 ? (
        <PaginationBar basePath="/admin/users" currentPage={page} totalPages={totalPages} searchParams={searchParams} />
      ) : null}
    </div>
  );
}
