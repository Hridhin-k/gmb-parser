import Link from "next/link";
import { Download } from "lucide-react";
import { FreshMetrics } from "@/components/fresh-metrics";
import { ReportsBoard } from "@/components/reports-board";
import { PageHeader } from "@/components/page-header";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { channelOptions, readDeliveryEnv } from "@/lib/reporting";
import { countExportableReviews } from "@/lib/services/review-export";
import { AlertService, listReportScopes, ReportService } from "@/lib/services/reporting";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getShellSummary } from "@/lib/services/shell-summary";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { workspaceGrant } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { overviewQueryKey } from "@/lib/overview-board";
import { isManager, scopedHref, shellAlerts } from "@/lib/shell";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "1m";

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const access = await getMemberAccess(user.id, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientId = resolved.clientId ?? "";
  const groupId = resolved.groupId ?? "";
  const locationId = resolved.locationId ?? "";
  const range = parseDateRange(params, DEFAULT_RANGE);

  const [reviewCount, reports, alerts, scopes, roster, summary] = await Promise.all([
    countExportableReviews(workspaceId, {
      clientId: clientId || null,
      groupId: groupId || null,
      locationId: locationId || null,
      since: range.start?.toISOString() ?? null,
      until: range.end?.toISOString() ?? null,
    }),
    ReportService.list(workspaceId),
    AlertService.list(workspaceId),
    listReportScopes(workspaceId),
    getWorkspaceRoster(workspaceId),
    getShellSummary(workspaceId, allowedClientIds),
  ]);

  const reviewExport = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientId) reviewExport.set("client", clientId);
  if (groupId) reviewExport.set("group", groupId);
  if (locationId) reviewExport.set("location", locationId);
  const usageExport = new URLSearchParams();
  if (clientId) usageExport.set("client", clientId);
  for (const [key, value] of Object.entries(dateRangeParams(range, DEFAULT_RANGE))) usageExport.set(key, value);

  const current = new URLSearchParams();
  if (clientId) current.set("client", clientId);
  if (groupId) current.set("group", groupId);
  if (locationId) current.set("location", locationId);
  for (const [key, value] of Object.entries(dateRangeParams(range, DEFAULT_RANGE))) current.set(key, value);
  const scopedPlaces = allowedClientIds
    ? await createAdminClient()
        .from("grm_google_locations")
        .select("id, group_id")
        .eq("workspace_id", workspaceId)
        .in("client_id", allowedClientIds.length ? allowedClientIds : ["00000000-0000-0000-0000-000000000000"])
    : null;
  const scopedGroups = allowedClientIds
    ? await createAdminClient()
        .from("grm_groups")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("client_id", allowedClientIds.length ? allowedClientIds : ["00000000-0000-0000-0000-000000000000"])
    : null;
  const locationOk = new Set((scopedPlaces?.data ?? []).map((place) => place.id));
  const groupOk = new Set([
    ...(scopedPlaces?.data ?? []).flatMap((place) => (place.group_id ? [place.group_id] : [])),
    ...(scopedGroups?.data ?? []).map((group) => group.id),
  ]);
  const visibleRecord = (row: { clientId: string | null; groupId: string | null; locationId: string | null }) => {
    if (!allowedClientIds) return true;
    if (row.locationId) return locationOk.has(row.locationId);
    if (row.groupId) return groupOk.has(row.groupId);
    if (row.clientId) return allowedClientIds.includes(row.clientId);
    return false;
  };
  const visibleReports = reports.reports.filter(visibleRecord);
  const visibleReportIds = new Set(visibleReports.map((report) => report.id));
  const visibleRules = alerts.rules.filter(visibleRecord);

  const attention = shellAlerts(summary, role).map((alert) => ({
    ...alert,
    href: scopedHref(alert.href, current, "/reports"),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports and alerts"
        description="Schedule a report from stored reviews, and turn on alert rules. Email, Slack, and WhatsApp send only when that provider is configured."
      />

      <FreshMetrics
        rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
        surface="reports"
      >
      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Exports for the dates above</h2>
        <ul className="mt-3 divide-y divide-silver">
          <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-graphite">Reviews</p>
              <p className="mt-0.5 text-sm text-slate">
                {reviewCount === 0
                  ? "No reviews in this period."
                  : `${reviewCount.toLocaleString("en-US")} ${reviewCount === 1 ? "review" : "reviews"} as a spreadsheet.`}
              </p>
            </div>
            {reviewCount > 0 ? (
              <a
                href={reviewExport.size ? `/api/reviews/export?${reviewExport.toString()}` : "/api/reviews/export"}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
              >
                <Download className="size-3.5" aria-hidden />
                Export CSV
              </a>
            ) : null}
          </li>
          {workspaceGrant(role, "manage_people") ? (
            <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-graphite">Usage</p>
                <p className="mt-0.5 text-sm text-slate">Stored locations, reviews, and published replies. No prices.</p>
              </div>
              <a
                href={`/api/usage/export${usageExport.size ? `?${usageExport}` : ""}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
              >
                <Download className="size-3.5" aria-hidden />
                Export CSV
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-graphite">Needs attention</h2>
        {attention.length === 0 ? (
          <p className="mt-3 text-sm text-slate">Nothing needs attention right now.</p>
        ) : (
          <ul className="mt-3 divide-y divide-silver">
            {attention.map((alert) => (
              <li key={alert.id} className="py-3">
                <Link href={alert.href} className="text-sm font-medium text-ink hover:underline">
                  {alert.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReportsBoard
        canManage={isManager(role)}
        channels={channelOptions(readDeliveryEnv(process.env))}
        members={roster.members.map((member) => member.email)}
        clients={allowedClientIds ? scopes.clients.filter((client) => allowedClientIds.includes(client.id)) : scopes.clients}
        groups={allowedClientIds ? scopes.groups.filter((group) => groupOk.has(group.id)) : scopes.groups}
        locations={allowedClientIds ? scopes.locations.filter((location) => locationOk.has(location.id)) : scopes.locations}
        reports={visibleReports}
        runs={reports.runs.filter((run) => visibleReportIds.has(run.reportId))}
        rules={visibleRules}
        events={
          allowedClientIds
            ? alerts.events.filter((event) => visibleRules.some((rule) => rule.name === event.ruleName))
            : alerts.events
        }
      />
      </FreshMetrics>
    </div>
  );
}
