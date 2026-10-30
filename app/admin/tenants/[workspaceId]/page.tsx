import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportViewButton, TenantActionsCard, TenantSettingsCard } from "@/components/platform-tenant-detail";
import {
  AdminCard,
  ConnectionStatusBadge,
  InviteStatusBadge,
  SyncStatusBadge,
  TenantStatusBadge,
  formatAdminDate,
  money,
} from "@/components/platform-admin-ui";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/services/session";
import { getTenantDetail } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";
import { roleName } from "@/lib/ui/vocabulary";

interface PageProps { params: Promise<{ workspaceId: string }> }

function fmt(value: string | null) {
  return formatAdminDate(value, true);
}

export default async function TenantDetailPage({ params }: PageProps) {
  const [{ workspaceId }, user] = await Promise.all([params, getCurrentUser()]);
  let detail: Awaited<ReturnType<typeof getTenantDetail>> | null = null;
  let failure: string | null = null;
  try {
    detail = await getTenantDetail(user!, workspaceId);
  } catch (error) {
    failure = toUserMessage(error);
  }
  if (failure) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Tenant" breadcrumbs={[{ label: "Tenants", href: "/admin" }, { label: "Tenant" }]} />
        <Banner tone="bad" title="This tenant could not be loaded.">
          {failure} Apply migrations 20261022001 + 20261022002 if this is a new database.
        </Banner>
      </div>
    );
  }
  if (!detail) notFound();
  const t = detail.tenant;
  const spent = detail.aiUsage.reduce((sum, u) => sum + u.estimatedUsd, 0);
  const calls = detail.aiUsage.reduce((sum, u) => sum + u.calls, 0);
  const overLocationCap = detail.counts.locations > 0 && t.maxLocations != null && detail.counts.locations > t.maxLocations;
  const overMemberCap = t.maxMembers != null && detail.members.length > t.maxMembers;
  const accessOff = detail.members.filter((m) => !m.accessEnabled).length;
  const brokenConnections = detail.connections.filter((c) => c.status !== "active").length;
  const failingLocations = detail.locations.filter((l) => l.syncStatus === "failed" || l.syncStatus === "partial").length;
  const onboarding = detail.onboarding
    ? detail.onboarding.completed ? { label: "Completed", variant: "ok" as const }
      : detail.onboarding.started ? { label: "Started, not completed", variant: "warn" as const }
      : { label: "Not started", variant: "default" as const }
    : { label: "Unknown", variant: "default" as const };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.name}
        breadcrumbs={[{ label: "Tenants", href: "/admin" }, { label: t.name }]}
        eyebrow={
          <>
            <TenantStatusBadge status={t.status} />
            <Badge variant="outline" className="capitalize">{t.plan} plan</Badge>
          </>
        }
        description={`Slug ${t.slug} · tenant id ${t.id} · created ${fmt(t.createdAt)} · owner ${detail.ownerEmail ?? "unknown"}`}
      >
        <SupportViewButton tenantId={t.id} disabled={t.status === "deleted"} />
      </PageHeader>

      <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-[#f59e0b] bg-demo px-3 py-2.5 text-[13px] text-demo-ink" role="note">
        <Badge variant="readonly">Read-only</Badge>
        <p className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold">Support view</span> opens this workspace as its users see it, with every action disabled and an amber banner that stays on screen. It lasts up to 4 hours, starts an entry in the tenant&apos;s audit log, and ends when you choose Exit support view. Ticket and owner-consent checks are not available yet.
        </p>
      </div>

      <KpiGrid>
        <KpiTile
          label="Status"
          value={<span className="capitalize">{t.status}</span>}
          tone={t.status === "active" ? "ok" : t.status === "suspended" ? "warn" : t.status === "deleted" ? "bad" : undefined}
          detail={t.planExpiresAt ? `Plan until ${formatAdminDate(t.planExpiresAt)}` : "No plan end date"}
        />
        <KpiTile label="Businesses" value={detail.counts.clients.toLocaleString("en-US")} />
        <KpiTile
          label="Locations"
          value={detail.counts.locations.toLocaleString("en-US")}
          tone={overLocationCap ? "warn" : undefined}
          detail={t.maxLocations != null ? `guidance cap ${t.maxLocations.toLocaleString("en-US")}` : "no cap"}
        />
        <KpiTile
          label="Members"
          value={detail.members.length.toLocaleString("en-US")}
          tone={overMemberCap ? "warn" : undefined}
          detail={`${t.maxMembers != null ? `limit ${t.maxMembers}` : "no limit"}${accessOff ? ` · ${accessOff} access off` : ""}`}
        />
        <KpiTile label="Reviews" value={detail.counts.reviews.toLocaleString("en-US")} />
        <KpiTile label="Escalations (all)" value={detail.counts.escalationsOpen.toLocaleString("en-US")} />
        <KpiTile
          label="AI recorded"
          value={money(spent)}
          tone="ai"
          detail={`${calls.toLocaleString("en-US")} calls · ${t.aiBudgetUsd != null ? `cap ${money(t.aiBudgetUsd)}/mo` : "platform default cap"}`}
          href="#ai-usage"
        />
      </KpiGrid>

      {overLocationCap ? (
        <Banner tone="warn" title="Over location guidance.">
          {detail.counts.locations} locations vs cap {t.maxLocations}. The cap isn&apos;t enforced; raise it in Plan &amp; limits or contact the owner.
        </Banner>
      ) : null}
      {brokenConnections > 0 || failingLocations > 0 ? (
        <Banner tone="bad" title="Needs attention.">
          {brokenConnections > 0 ? `${brokenConnections} Google connection${brokenConnections === 1 ? "" : "s"} not active. ` : ""}
          {failingLocations > 0 ? `${failingLocations} location${failingLocations === 1 ? "" : "s"} with failed or partial sync.` : ""}
        </Banner>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <TenantSettingsCard detail={detail} />

          <AdminCard id="ai-usage" title="AI usage" description={`Recorded ${money(spent)} across ${calls.toLocaleString("en-US")} calls`} bodyClassName="p-0">
            {detail.aiUsage.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No AI usage recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Estimated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.aiUsage.slice(0, 12).map((u) => (
                    <TableRow key={`${u.month}-${u.operation}`}>
                      <TableCell>{u.month}</TableCell>
                      <TableCell className="text-ink-2">{u.operation}</TableCell>
                      <TableCell className="text-right">{u.calls.toLocaleString("en-US")}</TableCell>
                      <TableCell className="text-right">{money(u.estimatedUsd, 4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AdminCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AdminCard title="Members" description={`${detail.members.length} member${detail.members.length === 1 ? "" : "s"}`} bodyClassName="p-0">
            {detail.members.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No members.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell className="max-w-64 truncate" title={m.email}>{m.email}</TableCell>
                      <TableCell className="text-ink-2">{roleName(m.role)}</TableCell>
                      <TableCell className="text-ink-2">{formatAdminDate(m.joinedAt)}</TableCell>
                      <TableCell>{m.accessEnabled ? <Badge variant="ok">Active</Badge> : <Badge variant="bad">Access off</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-col gap-1 border-t border-line-2 px-4 py-3 text-xs text-ink-3">
              {detail.pendingTeamInvites.length > 0 ? (
                <p>Pending team invites: {detail.pendingTeamInvites.map((i) => `${i.email} (${roleName(i.role)})`).join(", ")}</p>
              ) : (
                <p>No pending team invites.</p>
              )}
              {detail.platformInvite ? (
                <p className="flex flex-wrap items-center gap-1.5">
                  Came from platform invite {detail.platformInvite.email} <InviteStatusBadge status={detail.platformInvite.status} /> sent {fmt(detail.platformInvite.createdAt)}.
                </p>
              ) : (
                <p>No platform invite on record (grandfathered tenant).</p>
              )}
            </div>
          </AdminCard>

          <AdminCard
            title="Setup & Google connections"
            description={<span className="inline-flex flex-wrap items-center gap-1.5">Onboarding <Badge variant={onboarding.variant}>{onboarding.label}</Badge></span>}
            bodyClassName="p-0"
          >
            {detail.connections.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No Google connections.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {detail.connections.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0 truncate text-ink">{c.googleEmail}</span>
                    <span className="flex items-center gap-2 text-xs text-ink-3">
                      {c.lastRefreshedAt ? `refreshed ${fmt(c.lastRefreshedAt)}` : null}
                      <ConnectionStatusBadge status={c.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {detail.locations.length > 0 ? (
              <div className="border-t border-line-2">
                <p className="px-4 pb-1 pt-3 text-xs font-medium text-ink-3">
                  Locations {detail.locations.length > 10 ? `(first 10 of ${detail.locations.length})` : ""}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead>Sync</TableHead>
                      <TableHead>Last synced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.locations.slice(0, 10).map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="max-w-64">
                          <span className="block truncate" title={l.name}>{l.name}</span>
                          {l.isActive ? null : <span className="text-xs text-ink-3">inactive</span>}
                          {l.syncError ? <span className="block max-w-64 truncate text-xs text-bad" title={l.syncError}>{l.syncError}</span> : null}
                        </TableCell>
                        <TableCell><SyncStatusBadge status={l.syncStatus} /></TableCell>
                        <TableCell className="text-ink-2">{fmt(l.lastSyncedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </AdminCard>

          <TenantActionsCard tenantId={t.id} name={t.name} status={t.status} />

          <AdminCard title="Recent audit activity" bodyClassName="p-0">
            {detail.audit.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No audit rows.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {detail.audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <span className="font-medium text-ink">{a.action}</span>
                    <span className="text-xs text-ink-3">{a.entityType} · {fmt(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>
    </div>
  );
}
