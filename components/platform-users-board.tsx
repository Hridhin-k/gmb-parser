"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SearchX, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PaginationBar } from "@/components/pagination-bar";
import { AdminCard, formatAdminDate } from "@/components/platform-admin-ui";
import type { BlockedUserRow, GlobalUserRow } from "@/lib/services/platform";
import { roleName } from "@/lib/ui/vocabulary";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
}

function initials(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2)).toUpperCase() || "?";
}

export function PlatformUsersBoard({
  users,
  initialQuery,
  total,
  page,
  pageSize,
  blocked = [],
}: {
  users: GlobalUserRow[];
  initialQuery: string;
  total: number;
  page: number;
  pageSize: number;
  /** Platform-wide block list (by email), shown beside the table. */
  blocked?: BlockedUserRow[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const searchParams = new URLSearchParams();
  if (initialQuery) searchParams.set("q", initialQuery);
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<GlobalUserRow | null>(null);

  async function setBlocked(email: string, key: string, block: boolean) {
    setBusy(key);
    setError(null);
    try {
      await send("/api/platform/users", { email, blocked: block, reason: block ? "Blocked from super admin" : null });
      toast.success(block ? `${email} blocked platform-wide` : `${email} unblocked`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that user.");
    } finally {
      setBusy(null);
    }
  }

  function clearSearch() {
    setQuery("");
    router.replace("/admin/users");
  }

  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(total, (page - 1) * pageSize + users.length);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {error ? <Banner tone="bad" title="That didn't work.">{error}</Banner> : null}
        <AdminCard
          title="All users"
          description={
            total > 0
              ? `${firstShown.toLocaleString("en-US")}–${lastShown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} user${total === 1 ? "" : "s"}${initialQuery ? ` matching “${initialQuery}”` : ""}`
              : initialQuery ? `No users match “${initialQuery}”` : "No users yet"
          }
          actions={
            <form
              role="search"
              onSubmit={(e) => { e.preventDefault(); router.replace(`/admin/users${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`); }}
              className="flex w-full gap-2 sm:w-auto"
            >
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email…" aria-label="Search users" className="h-8 min-w-0 flex-1 sm:w-64" />
              <Button type="submit" variant="outline" size="sm" className="h-8">Search</Button>
              {initialQuery ? <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearSearch}>Clear</Button> : null}
            </form>
          }
          bodyClassName="p-0"
        >
          {users.length === 0 ? (
            initialQuery ? (
              <EmptyState bare icon={SearchX} title="No users match" description={<>No auth user email contains “{initialQuery}”.</>}>
                <Button type="button" variant="outline" size="sm" onClick={clearSearch}>Clear search</Button>
              </EmptyState>
            ) : (
              <EmptyState bare icon={UsersRound} title="No users yet" description="People appear here after they sign in with Google for the first time." />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId} className={user.blocked ? "bg-bad-tint/30" : undefined}>
                    <TableCell className="min-w-56">
                      <span className="flex items-center gap-2.5">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-ink-2" aria-hidden>{initials(user.email)}</span>
                        <span className="min-w-0 truncate font-medium text-ink" title={user.email}>{user.email}</span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {user.memberships.length === 0 ? (
                        <span className="text-ink-3">No tenant membership</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {user.memberships.map((m) => (
                            <li key={m.workspaceId} className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/admin/tenants/${m.workspaceId}`} className="text-ink hover:text-brand hover:underline">{m.tenantName}</Link>
                              <span className="text-xs text-ink-3">· {roleName(m.role)}</span>
                              {m.tenantStatus !== "active" ? <Badge variant={m.tenantStatus === "deleted" ? "bad" : "warn"} className="capitalize">{m.tenantStatus}</Badge> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-2">{user.lastSignInAt ? formatAdminDate(user.lastSignInAt) : "Never signed in"}</TableCell>
                    <TableCell>
                      {user.blocked ? <Badge variant="bad">Blocked</Badge> : user.memberships.length === 0 ? <Badge variant="default">No workspace</Badge> : <Badge variant="ok">Active</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {user.blocked ? (
                          <Button type="button" variant="outline" size="sm" loading={busy === user.userId} onClick={() => setBlocked(user.email, user.userId, false)}>Unblock</Button>
                        ) : (
                          <Button type="button" variant="destructive" size="sm" loading={busy === user.userId} onClick={() => setConfirmBlock(user)}>Block…</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 ? (
            <div className="border-t border-line-2 px-4 py-3">
              <PaginationBar basePath="/admin/users" currentPage={page} totalPages={totalPages} searchParams={searchParams} />
            </div>
          ) : null}
        </AdminCard>
      </div>

      <AdminCard
        title={<span className="flex items-center gap-2">Blocked <Badge variant={blocked.length > 0 ? "bad" : "default"}>{blocked.length}</Badge></span>}
        description="Platform-wide by email, checked at sign-in. Memberships and data are kept."
        bodyClassName="p-0"
      >
        {blocked.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-3">Nobody is blocked.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {blocked.map((b) => (
              <li key={b.email} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink" title={b.email}>{b.email}</p>
                  <p className="text-xs text-ink-3">{b.reason ?? "No reason given"} · {formatAdminDate(b.createdAt)}</p>
                </div>
                <Button type="button" variant="outline" size="xs" loading={busy === `blocked-${b.email}`} onClick={() => setBlocked(b.email, `blocked-${b.email}`, false)}>Unblock</Button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <ConfirmDialog
        open={confirmBlock !== null}
        onOpenChange={(open) => { if (!open) setConfirmBlock(null); }}
        title={confirmBlock ? `Block ${confirmBlock.email}?` : ""}
        description="They will be refused at their next sign-in across every tenant. Their memberships and data are kept, and you can unblock them at any time."
        confirmLabel="Block platform-wide"
        pendingLabel="Blocking…"
        tone="danger"
        onConfirm={async () => { if (confirmBlock) await setBlocked(confirmBlock.email, confirmBlock.userId, true); }}
      />
    </div>
  );
}
