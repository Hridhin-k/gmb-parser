import { getCurrentUser } from "@/lib/services/session";
import { loadPlatformHealth } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
}

export default async function PlatformHealthPage() {
  const user = await getCurrentUser();
  let health: Awaited<ReturnType<typeof loadPlatformHealth>> | null = null;
  let failure: string | null = null;
  try {
    health = await loadPlatformHealth(user!);
  } catch (error) {
    failure = toUserMessage(error);
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Platform health</h1>
        <p className="mt-1 text-sm font-light text-slate">Derived from live tables — there is no cron-run log table, so sync freshness is inferred from location <code>last_synced_at</code>.</p>
      </div>
      {failure || !health ? (
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite" role="alert">{failure ?? "Health could not be loaded."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[["Active connections", health.connections.active], ["Expired connections", health.connections.expired], ["Revoked", health.connections.revoked], ["Failed syncs", health.sync.failedLocations], ["Stale syncs (>48h)", health.sync.staleLocations], ["Pending invites", health.invites.pending]].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-silver bg-white px-4 py-3"><p className="text-2xl font-medium text-graphite">{value}</p><p className="text-xs text-slate">{label}</p></div>
            ))}
          </div>

          <section className="rounded-xl border border-silver bg-white px-4 py-4">
            <h2 className="text-lg font-medium text-graphite">Readiness</h2>
            <ul className="mt-2 space-y-1 text-sm text-graphite">
              <li>Platform invites table: {health.readiness.platformInvitesTable ? "available" : "MISSING — apply migration 20261022001"}</li>
              <li>Review intelligence tables: {health.readiness.reviewIntelligence ? "available" : "not available (migrations 20261020002+ or no rows yet)"}</li>
              <li>AI usage ledger: {health.readiness.aiUsageLedger ? "available" : "not available yet"}</li>
              <li>CRON_SECRET: {health.readiness.cronSecretConfigured ? "configured (scheduled jobs can run)" : "NOT configured — all cron routes return 401"}</li>
              <li>Invite email (Resend): {health.readiness.resendConfigured ? "configured" : "not configured — invites are saved, not emailed"}</li>
              <li>Super admins configured: {health.readiness.superAdminsConfigured} · Tenants active/suspended/deleted: {health.tenantsByStatus.active}/{health.tenantsByStatus.suspended}/{health.tenantsByStatus.deleted} · Expired pending invites: {health.invites.expiredPending}</li>
            </ul>
          </section>

          {health.plansExpiringSoon.length > 0 ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <h2 className="text-lg font-medium text-amber-900">Plans ending within 14 days</h2>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">{health.plansExpiringSoon.map((p) => <li key={p.id}>{p.name} — {p.plan}, ends {fmt(p.planExpiresAt)}</li>)}</ul>
            </section>
          ) : null}

          {health.connections.problemTenants.length > 0 ? (
            <section className="rounded-xl border border-silver bg-white px-4 py-4">
              <h2 className="text-lg font-medium text-graphite">Connection problems</h2>
              <ul className="mt-2 divide-y divide-silver rounded-xl border border-silver">
                {health.connections.problemTenants.map((c, i) => <li key={i} className="flex flex-wrap justify-between px-3 py-2 text-sm"><span className="text-graphite">{c.tenantName}</span><span className="text-xs text-slate">{c.googleEmail} · {c.status}</span></li>)}
              </ul>
            </section>
          ) : null}

          {health.sync.problems.length > 0 ? (
            <section className="rounded-xl border border-silver bg-white px-4 py-4">
              <h2 className="text-lg font-medium text-graphite">Sync problems (failed, partial, or stale)</h2>
              <ul className="mt-2 divide-y divide-silver rounded-xl border border-silver">
                {health.sync.problems.map((p, i) => <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="text-graphite">{p.locationName}</span><span className="text-xs text-slate">{p.syncStatus ?? "never"} · last {fmt(p.lastSyncedAt)}{p.syncError ? ` · ${p.syncError}` : ""}</span></li>)}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
