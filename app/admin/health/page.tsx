import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { AdminCard, ConnectionStatusBadge, SyncStatusBadge, formatAdminDate } from "@/components/platform-admin-ui";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/services/session";
import { loadPlatformHealth } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
}

type Check = { label: string; ok: boolean; okText: string; badText: string; severity: "bad" | "warn" };

export default async function PlatformHealthPage() {
  const user = await getCurrentUser();
  let health: Awaited<ReturnType<typeof loadPlatformHealth>> | null = null;
  let failure: string | null = null;
  try {
    health = await loadPlatformHealth(user!);
  } catch (error) {
    failure = toUserMessage(error);
  }

  const header = (
    <PageHeader
      title="Platform health"
      description={<>Derived from live tables. There is no cron-run log table, so sync freshness is inferred from location <code>last_synced_at</code>.</>}
    >
      <Link href="/admin/ops#announcement" className={buttonVariants({ variant: "default" })}>Post an announcement</Link>
    </PageHeader>
  );

  if (failure || !health) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Banner tone="bad" title="Health could not be loaded.">{failure ?? null}</Banner>
      </div>
    );
  }

  const checks: Check[] = [
    { label: "Platform invites table", ok: health.readiness.platformInvitesTable, okText: "Available", badText: "Missing — apply migration 20261022001", severity: "bad" },
    { label: "AI usage ledger", ok: health.readiness.aiUsageLedger, okText: "Available", badText: "Not available yet", severity: "warn" },
    { label: "CRON_SECRET", ok: health.readiness.cronSecretConfigured, okText: "Configured · scheduled jobs can run", badText: "Not configured — all cron routes return 401", severity: "bad" },
    { label: "Invite email (Resend)", ok: health.readiness.resendConfigured, okText: "Configured", badText: "Not configured — invites are saved, not emailed", severity: "warn" },
    { label: "Super admins", ok: health.readiness.superAdminsConfigured > 0, okText: `${health.readiness.superAdminsConfigured} configured`, badText: "None configured", severity: "warn" },
  ];
  const blocking = checks.filter((c) => !c.ok && c.severity === "bad");
  const problemConnections = health.connections.expired + health.connections.revoked;
  const { active, suspended, deleted } = health.tenantsByStatus;

  return (
    <div className="flex flex-col gap-4">
      {header}

      {blocking.length > 0 ? (
        <Banner tone="bad" title={`${blocking.length} setup problem${blocking.length === 1 ? "" : "s"}.`}>
          {blocking.map((c) => `${c.label}: ${c.badText}`).join(" · ")}
        </Banner>
      ) : problemConnections > 0 || health.sync.failedLocations > 0 ? (
        <Banner tone="warn" title="Some tenants need attention.">
          {problemConnections > 0 ? `${problemConnections} Google connection${problemConnections === 1 ? "" : "s"} expired or revoked. ` : ""}
          {health.sync.failedLocations > 0 ? `${health.sync.failedLocations} location${health.sync.failedLocations === 1 ? "" : "s"} with failed or partial sync.` : ""}
        </Banner>
      ) : (
        <Banner tone="ok" title="No problems found.">Connections and recent syncs look healthy in the live tables.</Banner>
      )}

      <KpiGrid>
        <KpiTile label="Active connections" value={health.connections.active.toLocaleString("en-US")} tone="ok" detail="Google accounts connected" />
        <KpiTile label="Expired connections" value={health.connections.expired.toLocaleString("en-US")} tone={health.connections.expired > 0 ? "warn" : undefined} href="#connections" detail="Owner must reconnect" />
        <KpiTile label="Revoked" value={health.connections.revoked.toLocaleString("en-US")} tone={health.connections.revoked > 0 ? "bad" : undefined} href="#connections" detail="Access removed at Google" />
        <KpiTile label="Failed syncs" value={health.sync.failedLocations.toLocaleString("en-US")} tone={health.sync.failedLocations > 0 ? "bad" : undefined} href="#sync" detail="Failed or partial" />
        <KpiTile label="Stale syncs" value={health.sync.staleLocations.toLocaleString("en-US")} tone={health.sync.staleLocations > 0 ? "warn" : undefined} href="#sync" detail="No sync in 48h" />
        <KpiTile label="Pending invites" value={health.invites.pending.toLocaleString("en-US")} href="/admin#invites" detail={`${health.invites.expiredPending} expired, not resent`} />
      </KpiGrid>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AdminCard title="Readiness" description="Configuration the platform depends on" bodyClassName="p-0">
          <ul className="divide-y divide-line-2">
            {checks.map((c) => (
              <li key={c.label} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="font-medium text-ink">{c.label}</span>
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  {c.ok ? c.okText : c.badText}
                  <Badge variant={c.ok ? "ok" : c.severity}>{c.ok ? "OK" : c.severity === "bad" ? "Blocking" : "Limited"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </AdminCard>

        <div className="flex min-w-0 flex-col gap-4">
          <AdminCard title="Tenants by status" bodyClassName="p-0">
            <ul className="divide-y divide-line-2 text-[13px]">
              <li className="flex items-center justify-between px-4 py-2.5"><Badge variant="ok">Active</Badge><span className="tabular-nums text-ink">{active.toLocaleString("en-US")}</span></li>
              <li className="flex items-center justify-between px-4 py-2.5"><Badge variant="warn">Suspended</Badge><span className="tabular-nums text-ink">{suspended.toLocaleString("en-US")}</span></li>
              <li className="flex items-center justify-between px-4 py-2.5"><Badge variant="bad">Deleted</Badge><span className="tabular-nums text-ink">{deleted.toLocaleString("en-US")}</span></li>
            </ul>
          </AdminCard>

          <AdminCard
            title="Plans ending within 14 days"
            tone={health.plansExpiringSoon.length > 0 ? "warn" : undefined}
            bodyClassName="p-0"
          >
            {health.plansExpiringSoon.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No active plans end in the next 14 days.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {health.plansExpiringSoon.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <Link href={`/admin/tenants/${p.id}`} className="font-medium text-ink hover:text-brand hover:underline">{p.name}</Link>
                    <span className="flex items-center gap-2 text-xs text-ink-3"><span className="capitalize">{p.plan}</span> · ends {formatAdminDate(p.planExpiresAt)}<Badge variant="warn">Ending soon</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>

      <AdminCard id="connections" title="Connection problems" description="Google connections that are not active (first 20)" bodyClassName="p-0">
        {health.connections.problemTenants.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">Every Google connection is active.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Google account</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.connections.problemTenants.map((c, i) => (
                <TableRow key={`${c.workspaceId}-${c.googleEmail}-${i}`}>
                  <TableCell><Link href={`/admin/tenants/${c.workspaceId}`} className="font-medium text-ink hover:text-brand hover:underline">{c.tenantName}</Link></TableCell>
                  <TableCell className="text-ink-2">{c.googleEmail}</TableCell>
                  <TableCell><ConnectionStatusBadge status={c.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminCard>

      <AdminCard id="sync" title="Sync problems" description="Failed, partial or stale active locations (up to 20 shown)" bodyClassName="p-0">
        {health.sync.problems.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">No failed, partial or stale syncs.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant · location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last synced</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.sync.problems.map((p, i) => (
                <TableRow key={`${p.workspaceId}-${p.locationName}-${i}`}>
                  <TableCell className="max-w-72">
                    <Link href={`/admin/tenants/${p.workspaceId}`} className="block truncate font-medium text-ink hover:text-brand hover:underline" title={p.locationName}>{p.locationName}</Link>
                  </TableCell>
                  <TableCell><SyncStatusBadge status={p.syncStatus} /></TableCell>
                  <TableCell className="text-ink-2">{fmt(p.lastSyncedAt)}</TableCell>
                  <TableCell className="max-w-80 truncate text-xs text-ink-3" title={p.syncError ?? undefined}>{p.syncError ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminCard>

      <p className="text-xs text-ink-3">Queue depth, job throughput, publishing and AI-provider latency aren&apos;t recorded yet, so they aren&apos;t shown here.</p>
    </div>
  );
}
