import Link from "next/link";
import { notFound } from "next/navigation";
import { TenantSettingsCard } from "@/components/platform-tenant-detail";
import { getCurrentUser } from "@/lib/services/session";
import { getTenantDetail } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";

interface PageProps { params: Promise<{ workspaceId: string }> }

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
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
    return <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite" role="alert">{failure} Apply migrations 20261022001 + 20261022002 if this is a new database.</p>;
  }
  if (!detail) notFound();
  const spent = detail.aiUsage.reduce((sum, u) => sum + u.estimatedUsd, 0);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-ink underline underline-offset-4">← All tenants</Link>
        <h1 className="mt-2 text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>{detail.tenant.name}</h1>
        <p className="mt-1 text-sm font-light text-slate">
          <span className="capitalize">{detail.tenant.status}</span> · owner {detail.ownerEmail ?? "unknown"} · created {fmt(detail.tenant.createdAt)} · slug {detail.tenant.slug}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Clients", detail.counts.clients], ["Locations", detail.counts.locations], ["Reviews", detail.counts.reviews.toLocaleString()], ["Escalations (all)", detail.counts.escalationsOpen]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-silver bg-white px-4 py-3"><p className="text-2xl font-medium text-graphite">{value}</p><p className="text-xs text-slate">{label}</p></div>
        ))}
      </div>
      {detail.counts.locations > 0 && detail.tenant.maxLocations && detail.counts.locations > detail.tenant.maxLocations ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">Over location guidance: {detail.counts.locations} locations vs cap {detail.tenant.maxLocations}.</p>
      ) : null}

      <section className="rounded-xl border border-silver bg-white px-4 py-4">
        <h2 className="text-lg font-medium text-graphite">Setup & connections</h2>
        <p className="mt-1 text-sm text-slate">
          Onboarding: {detail.onboarding ? (detail.onboarding.completed ? "completed" : detail.onboarding.started ? "started, not completed" : "not started") : "unknown"}
          {" · "}Google connections: {detail.connections.length === 0 ? "none" : detail.connections.map((c) => `${c.googleEmail} (${c.status})`).join(", ")}
        </p>
        {detail.locations.length > 0 ? (
          <ul className="mt-3 divide-y divide-silver rounded-xl border border-silver">
            {detail.locations.slice(0, 10).map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-graphite">{l.name}{l.isActive ? "" : " (inactive)"}</span>
                <span className="text-xs text-slate">{l.syncStatus ?? "never synced"} · last {fmt(l.lastSyncedAt)}{l.syncError ? ` · ${l.syncError}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-xl border border-silver bg-white px-4 py-4">
        <h2 className="text-lg font-medium text-graphite">People</h2>
        <ul className="mt-2 divide-y divide-silver rounded-xl border border-silver">
          {detail.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="text-graphite">{m.email}</span><span className="text-xs text-slate">{m.role} · joined {fmt(m.joinedAt)}{m.accessEnabled ? "" : " · access off"}</span></li>
          ))}
        </ul>
        {detail.pendingTeamInvites.length > 0 ? <p className="mt-2 text-xs text-slate">Pending team invites: {detail.pendingTeamInvites.map((i) => `${i.email} (${i.role})`).join(", ")}</p> : null}
        {detail.platformInvite ? <p className="mt-2 text-xs text-slate">Came from platform invite {detail.platformInvite.email} ({detail.platformInvite.status}, {fmt(detail.platformInvite.createdAt)}).</p> : <p className="mt-2 text-xs text-slate">No platform invite on record (grandfathered tenant).</p>}
      </section>

      <TenantSettingsCard detail={detail} />

      <section className="rounded-xl border border-silver bg-white px-4 py-4">
        <h2 className="text-lg font-medium text-graphite">AI usage (recorded ${spent.toFixed(2)})</h2>
        {detail.aiUsage.length === 0 ? <p className="mt-1 text-sm text-slate">No Gemini usage recorded.</p> : (
          <ul className="mt-2 divide-y divide-silver rounded-xl border border-silver">
            {detail.aiUsage.slice(0, 12).map((u) => (
              <li key={`${u.month}-${u.operation}`} className="flex justify-between px-3 py-2 text-sm"><span className="text-graphite">{u.month} · {u.operation}</span><span className="text-xs text-slate">{u.calls} calls · ${u.estimatedUsd.toFixed(4)}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-silver bg-white px-4 py-4">
        <h2 className="text-lg font-medium text-graphite">Recent audit activity</h2>
        {detail.audit.length === 0 ? <p className="mt-1 text-sm text-slate">No audit rows.</p> : (
          <ul className="mt-2 divide-y divide-silver rounded-xl border border-silver">
            {detail.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="text-graphite">{a.action}</span><span className="text-xs text-slate">{a.entityType} · {fmt(a.createdAt)}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
