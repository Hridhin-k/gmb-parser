"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, MailPlus, SearchX } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PaginationBar } from "@/components/pagination-bar";
import { AdminCard, InviteStatusBadge, TenantStatusBadge, money } from "@/components/platform-admin-ui";
import type { PlatformInviteRow, TenantRow } from "@/lib/services/platform";
import { formatFriendlyDate } from "@/lib/format-date";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; emailed?: boolean };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  return formatFriendlyDate(value);
}

type ConfirmState =
  | { kind: "tenant"; tenant: TenantRow; action: "suspend" | "delete" }
  | { kind: "invite"; invite: PlatformInviteRow }
  | null;

interface BoardProps {
  invites: PlatformInviteRow[];
  inviteTotal: number;
  invitePage: number;
  invitePageSize: number;
  tenants: TenantRow[];
  tenantTotal: number;
  page: number;
  pageSize: number;
  initialQuery: string;
}

export function PlatformAdminBoard({ invites, inviteTotal, invitePage, invitePageSize, tenants, tenantTotal, page, pageSize, initialQuery }: BoardProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [query, setQuery] = useState(initialQuery);

  // Search and both paginations are server-side, driven by the URL.
  const baseParams = new URLSearchParams();
  if (initialQuery) baseParams.set("q", initialQuery);
  if (page > 1) baseParams.set("page", String(page));
  if (invitePage > 1) baseParams.set("ipage", String(invitePage));
  const tenantPages = Math.max(1, Math.ceil(tenantTotal / pageSize));
  const invitePages = Math.max(1, Math.ceil(inviteTotal / invitePageSize));
  const firstShown = tenantTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(tenantTotal, (page - 1) * pageSize + tenants.length);

  async function act(key: string, fn: () => Promise<void>, success: string) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const data = await send("/api/platform/invites", { email: email.trim(), note: note.trim() || null });
      toast.success(`Tenant invite saved for ${email.trim()}`, {
        description: data.emailed
          ? "An invite email was sent. They sign in with Google using that exact email, then name their business."
          : "No email provider is configured, so no email was sent. Tell them to sign in with Google using that exact email within 7 days.",
      });
      setEmail("");
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invite.");
    } finally {
      setInviting(false);
    }
  }

  function clearSearch() {
    setQuery("");
    router.replace("/admin");
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Banner tone="bad" title="That didn't work.">{error}</Banner> : null}

      <AdminCard
        id="tenants"
        title="All tenants"
        description={
          tenantTotal > 0
            ? `Showing ${firstShown.toLocaleString("en-US")}–${lastShown.toLocaleString("en-US")} of ${tenantTotal.toLocaleString("en-US")} workspace${tenantTotal === 1 ? "" : "s"}, including grandfathered tenants created before invite-only.${initialQuery ? ` Matching “${initialQuery}”.` : ""}`
            : initialQuery ? `No workspaces match “${initialQuery}”.` : "No workspaces yet."
        }
        actions={
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = query.trim();
              router.replace(trimmed ? `/admin?q=${encodeURIComponent(trimmed)}` : "/admin");
            }}
            className="flex w-full gap-2 sm:w-auto"
          >
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenant or owner…" aria-label="Search tenants" className="h-8 min-w-0 flex-1 sm:w-64" />
            <Button type="submit" variant="outline" size="sm" className="h-8">Search</Button>
            {initialQuery ? <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearSearch}>Clear</Button> : null}
          </form>
        }
        bodyClassName="p-0"
      >
        {tenants.length === 0 ? (
          initialQuery ? (
            <EmptyState bare icon={SearchX} title="No tenants match" description={<>Nothing matches “{initialQuery}” in tenant names or owner emails.</>}>
              <Button type="button" variant="outline" size="sm" onClick={clearSearch}>Clear search</Button>
            </EmptyState>
          ) : (
            <EmptyState bare icon={Building2} title="No tenants yet" description="Invite a tenant owner below. Their workspace appears here after they sign in and name their business.">
              <a href="#invite-tenant" className={buttonVariants({ size: "sm" })}>Invite a tenant</a>
            </EmptyState>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Businesses</TableHead>
                <TableHead className="text-right">Locations</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead>AI · this month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => {
                const overBudget = tenant.aiBudgetUsd != null && tenant.aiSpentUsd >= tenant.aiBudgetUsd;
                return (
                  <TableRow key={tenant.id}>
                    <TableCell className="min-w-48">
                      <Link href={`/admin/tenants/${tenant.id}`} className="font-semibold text-ink hover:text-brand hover:underline">{tenant.name}</Link>
                      <p className="text-xs text-ink-3">{tenant.slug} · since {fmtDate(tenant.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize text-ink-2">{tenant.plan}</span>
                      {tenant.planExpiresAt ? <p className="text-xs text-ink-3">until {fmtDate(tenant.planExpiresAt)}</p> : null}
                    </TableCell>
                    <TableCell className="text-right">{tenant.clients.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{tenant.locations.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{tenant.members.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{tenant.reviews.toLocaleString("en-US")}</TableCell>
                    <TableCell className={overBudget ? "text-bad" : "text-ink-2"}>
                      {money(tenant.aiSpentUsd)}
                      <span className="text-xs text-ink-3">{tenant.aiBudgetUsd != null ? ` / ${money(tenant.aiBudgetUsd)} cap` : " · platform default"}</span>
                    </TableCell>
                    <TableCell>
                      <TenantStatusBadge status={tenant.status} />
                      {tenant.status === "suspended" && tenant.suspendedAt ? <p className="mt-0.5 text-xs text-ink-3">since {fmtDate(tenant.suspendedAt)}</p> : null}
                      {tenant.status === "deleted" && tenant.deletedAt ? <p className="mt-0.5 text-xs text-ink-3">on {fmtDate(tenant.deletedAt)}</p> : null}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-ink-2" title={tenant.ownerEmail ?? undefined}>{tenant.ownerEmail ?? "unknown"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/admin/tenants/${tenant.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open</Link>
                        {tenant.status === "active" ? (
                          <Button type="button" variant="ghost" size="sm" loading={busy === `suspend-${tenant.id}`} onClick={() => setConfirm({ kind: "tenant", tenant, action: "suspend" })}>Suspend</Button>
                        ) : null}
                        {tenant.status === "suspended" ? (
                          <Button type="button" variant="outline" size="sm" loading={busy === `reactivate-${tenant.id}`}
                            onClick={() => act(`reactivate-${tenant.id}`, async () => { await send(`/api/platform/tenants/${tenant.id}`, { action: "reactivate" }); }, `${tenant.name} reactivated`)}>Reactivate</Button>
                        ) : null}
                        {tenant.status !== "deleted" ? (
                          <Button type="button" variant="destructive" size="sm" loading={busy === `delete-${tenant.id}`} onClick={() => setConfirm({ kind: "tenant", tenant, action: "delete" })}>Delete</Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" loading={busy === `restore-${tenant.id}`}
                            onClick={() => act(`restore-${tenant.id}`, async () => { await send(`/api/platform/tenants/${tenant.id}`, { action: "restore" }); }, `${tenant.name} restored`)}>Restore</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {tenantPages > 1 ? (
          <div className="border-t border-line-2 px-4 py-3">
            <PaginationBar basePath="/admin" currentPage={page} totalPages={tenantPages} searchParams={baseParams} />
          </div>
        ) : null}
      </AdminCard>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <AdminCard
          id="invites"
          title="Tenant invitations"
          description={`${inviteTotal.toLocaleString("en-US")} invite${inviteTotal === 1 ? "" : "s"} on record. Pending and expired invites can be resent (extends 7 days) or revoked.`}
          bodyClassName="p-0"
        >
          {invites.length === 0 ? (
            <EmptyState bare icon={MailPlus} title="No tenant invites yet" description="Invites you send appear here with their status and expiry." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="min-w-48">
                      <span className="font-medium text-ink">{invite.email}</span>
                      {invite.note ? <p className="max-w-72 truncate text-xs text-ink-3" title={invite.note}>{invite.note}</p> : null}
                      {invite.workspaceId ? (
                        <p className="text-xs"><Link href={`/admin/tenants/${invite.workspaceId}`} className="text-brand hover:underline">Open tenant</Link></p>
                      ) : null}
                    </TableCell>
                    <TableCell><InviteStatusBadge status={invite.status} /></TableCell>
                    <TableCell className="text-ink-2">{fmtDate(invite.createdAt)}</TableCell>
                    <TableCell className="text-ink-2">{invite.status === "accepted" ? `accepted ${fmtDate(invite.acceptedAt)}` : fmtDate(invite.expiresAt)}</TableCell>
                    <TableCell>
                      {invite.status === "pending" || invite.status === "expired" ? (
                        <div className="flex justify-end gap-1.5">
                          <Button type="button" variant="outline" size="sm" loading={busy === `resend-${invite.id}`}
                            onClick={() => act(`resend-${invite.id}`, async () => { const d = await send(`/api/platform/invites/${invite.id}`, { action: "resend" }); if (!d.emailed) toast.info("Invite extended by 7 days. No email provider is configured, so tell them to sign in."); }, "Invite resent")}>Resend</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm({ kind: "invite", invite })}>Revoke</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {invitePages > 1 ? (
            <div className="border-t border-line-2 px-4 py-3">
              <PaginationBar basePath="/admin" currentPage={invitePage} totalPages={invitePages} searchParams={baseParams} paramName="ipage" />
            </div>
          ) : null}
        </AdminCard>

        <div className="flex flex-col gap-4">
          <AdminCard
            id="invite-tenant"
            title="Invite a tenant"
            description="One invite = one tenant owner = one workspace. Expires in 7 days."
          >
            <form onSubmit={handleInvite} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                Owner email
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.com" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                Note <span className="font-normal text-ink-3">(optional, only staff see it)</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agency pilot, signed Oct 20" maxLength={500} />
              </label>
              <Button type="submit" loading={inviting} className="self-start">{inviting ? "Inviting…" : "Invite tenant"}</Button>
              <p className="text-xs leading-relaxed text-ink-3">The owner signs in with Google using that exact email, names their business, then invites their own admins, managers and responders.</p>
            </form>
          </AdminCard>
          <div className="rounded-lg border border-line bg-white px-4 py-3 text-[13px] text-ink-2">
            <p className="font-semibold text-ink">Need several at once, or someone asked for access?</p>
            <p className="mt-0.5 text-xs text-ink-3">Bulk invites and access-request approvals are in Operations.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/admin/ops#access-requests" className={buttonVariants({ variant: "outline", size: "sm" })}>Access requests</Link>
              <Link href="/admin/ops#bulk-invite" className={buttonVariants({ variant: "ghost", size: "sm" })}>Bulk invite</Link>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={
          confirm?.kind === "invite" ? "Revoke this tenant invite?"
          : confirm?.action === "delete" ? `Delete ${confirm.tenant.name}?`
          : confirm ? `Suspend ${confirm.tenant.name}?` : ""
        }
        description={
          confirm?.kind === "invite" ? (<><span className="font-medium text-ink">{confirm.invite.email}</span> will no longer be able to create a tenant with this invite. You can invite them again later.</>)
          : confirm?.action === "delete" ? "This is a soft delete: the tenant disappears and nobody can sign in, but all data is retained and you can restore it from this dashboard."
          : "Every member of this tenant will be blocked at sign-in. Data is kept and you can reactivate the tenant at any time."
        }
        confirmLabel={confirm?.kind === "invite" ? "Revoke invite" : confirm?.action === "delete" ? "Delete tenant" : "Suspend tenant"}
        pendingLabel="Working…"
        tone="danger"
        onConfirm={async () => {
          if (confirm?.kind === "invite") {
            await act(`revoke-${confirm.invite.id}`, async () => { await send(`/api/platform/invites/${confirm.invite.id}`, { action: "revoke" }); }, "Invite revoked");
          } else if (confirm) {
            await act(`${confirm.action}-${confirm.tenant.id}`, async () => { await send(`/api/platform/tenants/${confirm.tenant.id}`, { action: confirm.action }); }, confirm.action === "delete" ? `${confirm.tenant.name} deleted` : `${confirm.tenant.name} suspended`);
          }
        }}
      />
    </div>
  );
}
