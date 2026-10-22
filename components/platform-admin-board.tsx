"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PaginationBar } from "@/components/pagination-bar";
import type { PlatformInviteRow, TenantRow } from "@/lib/services/platform";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; emailed?: boolean };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function fmtDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
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
          ? "An invite email was sent. They sign in with Google using that exact email, then name their organization."
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Invite a tenant</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">One invite = one tenant owner = one workspace. Expires in 7 days. The owner signs in with Google using that exact email, names their organization, then invites their own admins, managers, and members.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.com" aria-label="Tenant owner email" className="sm:flex-1" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={500} className="sm:w-56" />
            <Button type="submit" loading={inviting}>{inviting ? "Inviting…" : "Invite tenant"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Tenant invites</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">{inviteTotal} invite{inviteTotal === 1 ? "" : "s"}</p>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? <p className="text-sm text-slate">No tenant invites yet.</p> : (
            <ul className="divide-y divide-silver overflow-hidden rounded-xl border border-silver">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-graphite">{invite.email}</p>
                    <p className="text-xs text-slate">
                      <span className="capitalize">{invite.status}</span> · invited {fmtDate(invite.createdAt)} · expires {fmtDate(invite.expiresAt)}
                      {invite.note ? ` · ${invite.note}` : ""}
                    </p>
                  </div>
                  {invite.status === "pending" || invite.status === "expired" ? (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" loading={busy === `resend-${invite.id}`}
                        onClick={() => act(`resend-${invite.id}`, async () => { const d = await send(`/api/platform/invites/${invite.id}`, { action: "resend" }); if (!d.emailed) toast.info("Invite extended by 7 days. No email provider is configured, so tell them to sign in."); }, "Invite resent")}>Resend</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirm({ kind: "invite", invite })}>Revoke</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {invitePages > 1 ? (
            <PaginationBar basePath="/admin" currentPage={invitePage} totalPages={invitePages} searchParams={baseParams} paramName="ipage" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Tenants</CardTitle>
              <p className="mt-1 text-sm font-light text-slate">{tenantTotal} workspace{tenantTotal === 1 ? "" : "s"} including grandfathered tenants created before invite-only.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = query.trim();
                router.replace(trimmed ? `/admin?q=${encodeURIComponent(trimmed)}` : "/admin");
              }}
              className="flex gap-2"
            >
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenant or owner…" aria-label="Search tenants" className="sm:w-64" />
              <Button type="submit" variant="outline">Search</Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {tenants.length === 0 ? <p className="text-sm text-slate">No tenants match.</p> : (
            <ul className="divide-y divide-silver overflow-hidden rounded-xl border border-silver">
              {tenants.map((tenant) => (
                <li key={tenant.id} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-graphite">
                      <a href={`/admin/tenants/${tenant.id}`} className="underline underline-offset-4">{tenant.name}</a>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${tenant.status === "active" ? "bg-emerald-50 text-emerald-700" : tenant.status === "suspended" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{tenant.status}</span>
                    </p>
                    <p className="text-xs text-slate">
                      Owner {tenant.ownerEmail ?? "unknown"} · {tenant.members} members · {tenant.clients} clients · {tenant.locations} locations · {tenant.reviews.toLocaleString()} reviews · since {fmtDate(tenant.createdAt)} · plan <span className="capitalize">{tenant.plan}</span>{tenant.planExpiresAt ? ` (until ${fmtDate(tenant.planExpiresAt)})` : ""} · AI ${tenant.aiSpentUsd.toFixed(2)}{tenant.aiBudgetUsd != null ? ` / $${tenant.aiBudgetUsd.toFixed(2)} cap` : " this month"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {tenant.status === "active" ? (
                      <Button type="button" variant="outline" size="sm" loading={busy === `suspend-${tenant.id}`} onClick={() => setConfirm({ kind: "tenant", tenant, action: "suspend" })}>Suspend</Button>
                    ) : null}
                    {tenant.status === "suspended" ? (
                      <Button type="button" variant="outline" size="sm" loading={busy === `reactivate-${tenant.id}`}
                        onClick={() => act(`reactivate-${tenant.id}`, async () => { await send(`/api/platform/tenants/${tenant.id}`, { action: "reactivate" }); }, `${tenant.name} reactivated`)}>Reactivate</Button>
                    ) : null}
                    {tenant.status !== "deleted" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirm({ kind: "tenant", tenant, action: "delete" })}>Delete</Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" loading={busy === `restore-${tenant.id}`}
                        onClick={() => act(`restore-${tenant.id}`, async () => { await send(`/api/platform/tenants/${tenant.id}`, { action: "restore" }); }, `${tenant.name} restored`)}>Restore</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tenantPages > 1 ? (
            <PaginationBar basePath="/admin" currentPage={page} totalPages={tenantPages} searchParams={baseParams} />
          ) : null}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={
          confirm?.kind === "invite" ? "Revoke this tenant invite?"
          : confirm?.action === "delete" ? `Delete ${confirm.tenant.name}?`
          : confirm ? `Suspend ${confirm.tenant.name}?` : ""
        }
        description={
          confirm?.kind === "invite" ? (<><span className="font-medium text-graphite">{confirm.invite.email}</span> will no longer be able to create a tenant with this invite. You can invite them again later.</>)
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
