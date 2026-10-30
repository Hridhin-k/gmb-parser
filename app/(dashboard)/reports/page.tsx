import Link from "next/link";
import { Download } from "lucide-react";
import { FreshMetrics } from "@/components/fresh-metrics";
import { ReportsBoard, type ReportsTab } from "@/components/reports-board";
import { Panel } from "@/components/analytics-panel";
import { buttonVariants } from "@/components/ui/button";
import { modernizeCopy } from "@/lib/ui/vocabulary";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { channelOptions, readDeliveryEnv } from "@/lib/reporting";
import { countExportableReviews } from "@/lib/services/review-export";
import { AlertService, listReportScopes, ReportService } from "@/lib/services/reporting";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getShellSummary } from "@/lib/services/shell-summary";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds, visibleLocationIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { workspaceGrant } from "@/lib/access";
import { createAdminClient } from "@/lib/db/client";
import { overviewQueryKey } from "@/lib/overview-board";
import { isManager, scopedHref, shellAlerts } from "@/lib/shell";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "1m";
// Kept here, not imported from the client board: a server file only sees client references.
const TABS: readonly ReportsTab[] = ["reports", "alerts", "history", "failures"];

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const access = await getMemberAccess(user.id, workspaceId);
  const [allowedClientIds, locationIds] = await Promise.all([
    visibleClientIds(workspaceId, access?.scope),
    visibleLocationIds(workspaceId, access?.scope),
  ]);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientId = resolved.clientId ?? "";
  const groupId = resolved.groupId ?? "";
  const locationId = resolved.locationId ?? "";
  const range = parseDateRange(params, DEFAULT_RANGE);

  const admin = createAdminClient();
  const scopedClientIds = allowedClientIds?.length
    ? allowedClientIds
    : ["00000000-0000-0000-0000-000000000000"];
  const [reviewCount, reports, alerts, scopes, roster, summary, scopedPlaces, scopedGroups] = await Promise.all([
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
    getShellSummary(workspaceId, allowedClientIds, locationIds, user.id),
    allowedClientIds
      ? admin
          .from("grm_google_locations")
          .select("id, group_id")
          .eq("workspace_id", workspaceId)
          .in("client_id", scopedClientIds)
      : Promise.resolve(null),
    allowedClientIds
      ? admin
          .from("grm_groups")
          .select("id")
          .eq("workspace_id", workspaceId)
          .in("client_id", scopedClientIds)
      : Promise.resolve(null),
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

  const requestedTab = typeof params.tab === "string" ? params.tab : "reports";
  const tab: ReportsTab = (TABS as readonly string[]).includes(requestedTab) ? (requestedTab as ReportsTab) : "reports";
  const initialEdit = typeof params.edit === "string" ? params.edit : null;
  const canExportUsage = workspaceGrant(role, "manage_people");

  const aside = (
    <>
      <Panel title="Exports for the dates above" hint={`${modernizeCopy(resolved.title)} · ${range.label}`}>
        <ul className="flex flex-col divide-y divide-line-2">
          <li className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Reviews</p>
              <p className="text-xs text-ink-3">
                {reviewCount === 0
                  ? "No reviews in this period."
                  : `${reviewCount.toLocaleString("en-US")} ${reviewCount === 1 ? "review" : "reviews"} as a spreadsheet.`}
              </p>
            </div>
            {reviewCount > 0 ? (
              <a
                href={reviewExport.size ? `/api/reviews/export?${reviewExport.toString()}` : "/api/reviews/export"}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Download aria-hidden />
                CSV
              </a>
            ) : null}
          </li>
          {canExportUsage ? (
            <li className="flex flex-wrap items-center justify-between gap-2 pt-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">Usage</p>
                <p className="text-xs text-ink-3">Stored locations, reviews, and published replies. No prices.</p>
              </div>
              <a
                href={`/api/usage/export${usageExport.size ? `?${usageExport}` : ""}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Download aria-hidden />
                CSV
              </a>
            </li>
          ) : null}
        </ul>
      </Panel>
      <Panel title="Needs attention">
        {attention.length === 0 ? (
          <p className="text-[13px] text-ink-3">Nothing needs attention right now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-2">
            {attention.map((alert) => (
              <li key={alert.id} className="py-2 first:pt-0 last:pb-0">
                <Link href={alert.href} className="text-[13px] font-medium text-ink hover:text-brand">
                  {alert.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );

  return (
    <FreshMetrics
      rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
      surface="reports"
    >
      <ReportsBoard
        tab={tab}
        query={current.toString()}
        initialEdit={initialEdit}
        description="Scheduled summaries and rule-based alerts. Each report keeps its own scope. Email, Slack and WhatsApp send only when that provider is configured."
        aside={aside}
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
  );
}
