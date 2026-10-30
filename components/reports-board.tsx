"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Bell, FileText, MoreHorizontal, Plus, X } from "lucide-react";
import { ALERT_KINDS, REPORT_FREQUENCIES, REPORT_SECTIONS, type ChannelOption } from "@/lib/reporting";
import type { AlertEventRow, AlertRuleRow, ReportRunRow, SavedReport } from "@/lib/services/reporting";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { NoData, Panel } from "@/components/analytics-panel";
import { PageHeader, PageTabs } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type ReportsTab = "reports" | "alerts" | "history" | "failures";

interface ScopeOption {
  id: string;
  name: string;
}

interface ReportsBoardProps {
  canManage: boolean;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  reports: SavedReport[];
  runs: ReportRunRow[];
  rules: AlertRuleRow[];
  events: AlertEventRow[];
  /** Active contextual tab (from the `tab` URL param). */
  tab?: ReportsTab;
  /** Current scope/period query, kept on tab links. */
  query?: string;
  /** Header line under the title. */
  description?: string;
  /** Server-rendered side panels (exports, needs attention) shown on the Reports tab. */
  aside?: React.ReactNode;
  /** Open this report in the edit drawer on load (from `?edit=`). */
  initialEdit?: string | null;
}

type Drawer = { kind: "report"; id: string | null } | { kind: "alert"; id: string | null } | null;
type Pending = { kind: "report" | "alert"; id: string; name: string } | null;

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return payload.error ?? "That did not save.";
  return null;
}

const CHANNEL_NAMES: Record<string, string> = {
  in_app: "Saved in app",
  email: "Email",
  slack: "Slack",
  whatsapp: "WhatsApp",
};

function channelName(id: string): string {
  return CHANNEL_NAMES[id] ?? id;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function scheduleLabel(report: SavedReport): string {
  const time = `${report.deliveryTime} (${report.timezone})`;
  if (report.frequency === "weekly") return `${WEEKDAYS[report.weekday ?? 1] ?? "Weekly"}s at ${time}`;
  if (report.frequency === "monthly") return `Day ${report.dayOfMonth ?? 1} of each month at ${time}`;
  return `Daily at ${time}`;
}

function sectionsLabel(ids: string[]): string {
  return ids.map((id) => REPORT_SECTIONS.find((section) => section.id === id)?.label ?? id).join(" · ");
}

export function RunStatusBadge({ status }: { status: string }) {
  if (status === "delivered") return <Badge variant="ok">Delivered</Badge>;
  if (status === "failed") return <Badge variant="bad">Failed</Badge>;
  if (status === "running") return <Badge variant="info">Running</Badge>;
  if (status === "skipped") return <Badge>Skipped</Badge>;
  return <Badge>{status}</Badge>;
}

export function DeliveryStatusBadge({ status }: { status: string }) {
  if (status === "sent") return <Badge variant="ok">Sent</Badge>;
  if (status === "recorded") return <Badge variant="ok">Saved</Badge>;
  if (status === "unavailable") return <Badge variant="warn">Channel not set up</Badge>;
  if (status === "failed") return <Badge variant="bad">Failed</Badge>;
  return <Badge>{status}</Badge>;
}

function alertCondition(rule: AlertRuleRow): string {
  const days = `${rule.windowDays} ${rule.windowDays === 1 ? "day" : "days"}`;
  switch (rule.kind) {
    case "negative_reviews":
      return `${rule.threshold}+ reviews rated 1–3★ at one location within ${days}`;
    case "rating_drop":
      return `Average falls by ${rule.dropPoints} or more vs the previous ${days} (min ${rule.minReviews} reviews)`;
    case "review_burst":
      return `Reviews reach ${rule.multiplier}× the previous ${days}`;
    default:
      return ALERT_KINDS.find((kind) => kind.id === rule.kind)?.detail ?? "";
  }
}

function deliveryFailed(deliveries: ReportRunRow["deliveries"]): boolean {
  return deliveries.some((delivery) => delivery.status === "failed");
}

export function ReportsBoard(props: ReportsBoardProps) {
  const router = useRouter();
  const tab: ReportsTab = props.tab ?? "reports";
  const [reportError, setReportError] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(() =>
    props.canManage && props.initialEdit && props.reports.some((item) => item.id === props.initialEdit)
      ? { kind: "report", id: props.initialEdit }
      : null
  );
  const [confirmDelete, setConfirmDelete] = useState<Pending>(null);

  function closeDrawer() {
    setDrawer(null);
    setReportError(null);
    setAlertError(null);
  }

  async function run(
    task: () => Promise<string | null>,
    setError: (value: string | null) => void,
    options?: { closeDrawer?: boolean; success?: string }
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    const error = await task();
    setPending(false);
    if (error) {
      setError(error);
      return false;
    }
    if (options?.closeDrawer !== false) setDrawer(null);
    if (options?.success) setNotice(options.success);
    router.refresh();
    return true;
  }

  const scopeNames = new Map<string, string>([
    ...props.clients.map((item) => [`client:${item.id}`, item.name] as const),
    ...props.groups.map((item) => [`group:${item.id}`, item.name] as const),
    ...props.locations.map((item) => [`location:${item.id}`, item.name] as const),
  ]);
  const scopeOf = (row: { clientId: string | null; groupId: string | null; locationId: string | null }) => {
    if (row.locationId) return { kind: "Location", name: scopeNames.get(`location:${row.locationId}`) ?? "Location" };
    if (row.groupId) return { kind: "Group", name: scopeNames.get(`group:${row.groupId}`) ?? "Group" };
    if (row.clientId) return { kind: "Business", name: scopeNames.get(`client:${row.clientId}`) ?? "Business" };
    return { kind: "Workspace", name: "Whole workspace" };
  };

  const latestRun = new Map<string, ReportRunRow>();
  for (const item of props.runs) {
    const existing = latestRun.get(item.reportId);
    if (!existing || existing.startedAt < item.startedAt) latestRun.set(item.reportId, item);
  }
  const failedRuns = props.runs.filter((item) => item.status === "failed" || deliveryFailed(item.deliveries));
  const failedEvents = props.events.filter((event) => deliveryFailed(event.deliveries));
  const failureCount = failedRuns.length + failedEvents.length;
  const newestFailure = failedRuns[0] ?? null;

  const tabHref = (id: ReportsTab) => {
    const params = new URLSearchParams(props.query ?? "");
    params.delete("edit");
    if (id === "reports") params.delete("tab");
    else params.set("tab", id);
    const text = params.toString();
    return text ? `/reports?${text}` : "/reports";
  };

  const editingReport = drawer?.kind === "report" && drawer.id ? props.reports.find((item) => item.id === drawer.id) ?? null : null;
  const editingRule = drawer?.kind === "alert" && drawer.id ? props.rules.find((item) => item.id === drawer.id) ?? null : null;
  const manageHint = props.canManage ? undefined : "Only managers can create or change reports and alerts.";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reports & alerts"
        description={
          props.description ??
          "Scheduled summaries and rule-based alerts. Email, Slack and WhatsApp send only when that provider is configured."
        }
      >
        <Button
          variant="outline"
          disabled={!props.canManage}
          title={manageHint}
          onClick={() => {
            setAlertError(null);
            setDrawer({ kind: "alert", id: null });
          }}
        >
          <Bell aria-hidden />
          New alert rule
        </Button>
        <Button
          disabled={!props.canManage}
          title={manageHint}
          onClick={() => {
            setReportError(null);
            setDrawer({ kind: "report", id: null });
          }}
        >
          <Plus aria-hidden />
          New report
        </Button>
      </PageHeader>

      <PageTabs
        tabs={[
          { label: "Reports", href: tabHref("reports"), active: tab === "reports", count: props.reports.length },
          { label: "Alert rules", href: tabHref("alerts"), active: tab === "alerts", count: props.rules.length },
          { label: "Run history", href: tabHref("history"), active: tab === "history", count: props.runs.length },
          {
            label: "Failures",
            href: tabHref("failures"),
            active: tab === "failures",
            count: failureCount > 0 ? failureCount : null,
            tone: "bad",
          },
        ]}
      />

      {notice ? (
        <Banner tone="ok" actions={<Button variant="ghost" size="xs" onClick={() => setNotice(null)}>Dismiss</Button>}>
          {notice}
        </Banner>
      ) : null}
      {!drawer && reportError ? <Banner tone="bad" title="That did not work.">{reportError}</Banner> : null}
      {!drawer && alertError ? <Banner tone="bad" title="That did not work.">{alertError}</Banner> : null}

      {tab === "reports" ? (
        <>
          {newestFailure ? (
            <Banner
              tone="bad"
              title={`“${newestFailure.reportName}” ${newestFailure.status === "failed" ? "failed" : "failed to deliver"} on ${formatWhen(newestFailure.startedAt)}.`}
              actions={
                <>
                  {newestFailure.reportId ? (
                    <Link href={`/reports/${newestFailure.reportId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      Open report
                    </Link>
                  ) : null}
                  <Link href={tabHref("failures")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    All failures
                  </Link>
                </>
              }
            >
              {newestFailure.error ??
                newestFailure.deliveries.find((delivery) => delivery.status === "failed")?.detail ??
                "One or more deliveries did not go through."}
            </Banner>
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel title="Scheduled reports" hint="Each report keeps its own scope; it does not follow the scope bar." flush>
              {props.reports.length === 0 ? (
                <EmptyState
                  bare
                  icon={FileText}
                  title="No reports yet"
                  description="Schedule a summary of stored reviews for a business, group or location. Recipients get it on the day and time you choose."
                >
                  {props.canManage ? (
                    <Button size="sm" onClick={() => setDrawer({ kind: "report", id: null })}>
                      <Plus aria-hidden />
                      New report
                    </Button>
                  ) : null}
                </EmptyState>
              ) : (
                <Table className="min-w-[56rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Recipients · channel</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Next run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.reports.map((item) => {
                      const last = latestRun.get(item.id);
                      const broken = last ? last.status === "failed" || deliveryFailed(last.deliveries) : false;
                      const where = scopeOf(item);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-normal">
                            <Link href={`/reports/${item.id}`} className="font-medium text-ink hover:text-brand">
                              {item.name}
                            </Link>
                            <div className="text-xs text-ink-3">{sectionsLabel(item.sections)}</div>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <span className="text-ink-2">{where.name}</span>
                            <div className="text-xs text-ink-3">{where.kind}</div>
                          </TableCell>
                          <TableCell className="whitespace-normal text-ink-2">{scheduleLabel(item)}</TableCell>
                          <TableCell className="whitespace-normal text-ink-2">
                            {item.recipients.length === 0
                              ? "No recipients"
                              : item.recipients.length === 1
                                ? item.recipients[0]
                                : `${item.recipients[0]} +${item.recipients.length - 1}`}
                            <div className="text-xs text-ink-3">{item.channels.map(channelName).join(", ") || "Saved in app"}</div>
                          </TableCell>
                          <TableCell>
                            {last ? (
                              <span className="flex flex-col items-start gap-1">
                                <span className="text-ink-2">{formatWhen(last.startedAt)}</span>
                                {broken && last.status !== "failed" ? <Badge variant="bad">Delivery failed</Badge> : <RunStatusBadge status={last.status} />}
                              </span>
                            ) : (
                              <span className="text-ink-3">Not run yet</span>
                            )}
                          </TableCell>
                          <TableCell className="text-ink-2">{item.enabled ? formatWhen(item.nextRunAt) : "—"}</TableCell>
                          <TableCell>
                            {!item.enabled ? (
                              <Badge>Paused</Badge>
                            ) : broken ? (
                              <Badge variant="warn">Needs fix</Badge>
                            ) : (
                              <Badge variant="ok">Active</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} />}
                              >
                                <MoreHorizontal aria-hidden />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem render={<Link href={`/reports/${item.id}`} />}>Open report</DropdownMenuItem>
                                <DropdownMenuItem render={<a href={`/api/reports/${item.id}/pdf`} />}>Download PDF</DropdownMenuItem>
                                <DropdownMenuItem render={<a href={`/api/reports/${item.id}/csv`} />}>Download CSV</DropdownMenuItem>
                                {props.canManage ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setReportError(null);
                                        setDrawer({ kind: "report", id: item.id });
                                      }}
                                    >
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={pending}
                                      onClick={() =>
                                        void run(() => send(`/api/reports/${item.id}/test`, "POST"), setReportError, {
                                          success: `Test of “${item.name}” sent. It appears in Run history.`,
                                        })
                                      }
                                    >
                                      Send test
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      disabled={pending}
                                      onClick={() => setConfirmDelete({ kind: "report", id: item.id, name: item.name })}
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Panel>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel
                title="Recent runs"
                action={
                  props.runs.length > 0 ? (
                    <Link href={tabHref("history")} className="text-xs font-medium text-brand hover:underline">
                      Full history
                    </Link>
                  ) : undefined
                }
              >
                {props.runs.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No runs yet. A test or a due schedule records one here.</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {props.runs.slice(0, 5).map((item) => {
                      const bad = item.status === "failed" || deliveryFailed(item.deliveries);
                      return (
                        <li key={item.id} className="flex gap-2.5 text-xs">
                          <span
                            className={cn(
                              "mt-1 size-2 shrink-0 rounded-full",
                              bad ? "bg-bad" : item.status === "delivered" ? "bg-ok" : item.status === "running" ? "bg-info" : "bg-ink-3"
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 text-ink-2">
                            <b className="font-medium text-ink">{item.reportName}</b> · {item.trigger === "test" ? "test" : "scheduled"} ·{" "}
                            {bad ? "failed" : item.status}
                            <span className="block text-ink-3">{formatWhen(item.startedAt)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Panel>
              <Panel title="Delivery channels" hint="Set up by the workspace; unavailable channels are greyed out in forms.">
                <ul className="flex flex-col gap-2 text-[13px]">
                  {props.channels.map((channel) => (
                    <li key={channel.id} className="flex flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{channelName(channel.id)}</span>
                        {channel.available ? <Badge variant="ok">Available</Badge> : <Badge>Not set up</Badge>}
                      </span>
                      {channel.reason ? <span className="text-xs text-ink-3">{channel.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </Panel>
              {props.aside}
            </div>
          </div>
        </>
      ) : null}

      {tab === "alerts" ? (
        <>
          <Panel
            title="Alert rules"
            hint="Rules are checked on a schedule. A repeated check does not record the same event twice."
            flush
            action={
              props.canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={pending}
                  onClick={() =>
                    void run(() => send("/api/alerts/run", "POST"), setAlertError, { success: "Alert rules checked. New matches appear in the history below." })
                  }
                >
                  Check now
                </Button>
              ) : undefined
            }
          >
            {props.rules.length === 0 ? (
              <EmptyState
                bare
                icon={Bell}
                title="No alert rules yet"
                description="Get told when negative reviews pile up, a rating drops, a review mentions legal or safety words, or a Google connection expires."
              >
                {props.canManage ? (
                  <Button size="sm" onClick={() => setDrawer({ kind: "alert", id: null })}>
                    <Plus aria-hidden />
                    New alert rule
                  </Button>
                ) : null}
              </EmptyState>
            ) : (
              <Table className="min-w-[52rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Notify</TableHead>
                    <TableHead className="text-right">Recent matches</TableHead>
                    <TableHead>Status</TableHead>
                    {props.canManage ? (
                      <TableHead className="w-32">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {props.rules.map((item) => {
                    const where = scopeOf(item);
                    const matches = props.events.filter((event) => event.ruleName === item.name).length;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-normal">
                          <span className="font-medium text-ink">{item.name}</span>
                          <div className="text-xs text-ink-3">{ALERT_KINDS.find((kind) => kind.id === item.kind)?.label}</div>
                        </TableCell>
                        <TableCell className="max-w-[18rem] whitespace-normal text-ink-2">{alertCondition(item)}</TableCell>
                        <TableCell className="whitespace-normal text-ink-2">{where.name}</TableCell>
                        <TableCell className="whitespace-normal text-ink-2">
                          {item.recipients.length === 0
                            ? "No recipients"
                            : `${item.recipients.length} ${item.recipients.length === 1 ? "person" : "people"}`}
                          <div className="text-xs text-ink-3">{item.channels.map(channelName).join(", ") || "Saved in app"}</div>
                        </TableCell>
                        <TableCell className="text-right">{matches.toLocaleString("en-US")}</TableCell>
                        <TableCell>{item.enabled ? <Badge variant="ok">On</Badge> : <Badge>Off</Badge>}</TableCell>
                        {props.canManage ? (
                          <TableCell className="text-right">
                            <span className="inline-flex gap-1">
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  setAlertError(null);
                                  setDrawer({ kind: "alert", id: item.id });
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-bad hover:text-bad"
                                disabled={pending}
                                onClick={() => setConfirmDelete({ kind: "alert", id: item.id, name: item.name })}
                              >
                                Delete
                              </Button>
                            </span>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>
          <AlertHistory events={props.events} />
        </>
      ) : null}

      {tab === "history" ? <RunTable runs={props.runs} title="Run history" hint="The 20 most recent report runs, with each delivery." /> : null}

      {tab === "failures" ? (
        failureCount === 0 ? (
          <EmptyState
            title="No failures"
            description="Every recent report run and alert delivery went through. Failed runs and deliveries are listed here when they happen."
          />
        ) : (
          <>
            {failedRuns.length > 0 ? (
              <RunTable runs={failedRuns} title="Report runs with failures" hint="Fix the channel or recipient, then send a test from the report's menu." />
            ) : null}
            {failedEvents.length > 0 ? <AlertHistory events={failedEvents} title="Alert deliveries with failures" /> : null}
          </>
        )
      ) : null}

      <ReportsDrawer
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open && !pending) closeDrawer();
        }}
        title={
          drawer?.kind === "alert" ? (editingRule ? "Edit alert rule" : "New alert rule") : editingReport ? "Edit report" : "New report"
        }
        description={
          drawer?.kind === "alert"
            ? "Choose what to watch, where, and who hears about it."
            : "Choose what goes in, for which scope, when it is sent and to whom."
        }
        footer={
          drawer?.kind === "report" ? (
            <>
              {editingReport ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    void run(() => send(`/api/reports/${editingReport.id}/test`, "POST"), setReportError, {
                      closeDrawer: false,
                      success: `Test of “${editingReport.name}” sent. It appears in Run history.`,
                    })
                  }
                >
                  Send a test
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button variant="outline" disabled={pending} onClick={closeDrawer}>
                Cancel
              </Button>
              <Button type="submit" form="report-form" loading={pending}>
                {editingReport ? "Save report" : "Create report"}
              </Button>
            </>
          ) : drawer?.kind === "alert" ? (
            <>
              <span className="flex-1" />
              <Button variant="outline" disabled={pending} onClick={closeDrawer}>
                Cancel
              </Button>
              <Button type="submit" form="alert-form" loading={pending}>
                {editingRule ? "Save alert" : "Create alert"}
              </Button>
            </>
          ) : null
        }
      >
        {drawer?.kind === "report" && props.canManage ? (
          <ReportForm
            key={editingReport?.id ?? "new-report"}
            report={editingReport}
            channels={props.channels}
            members={props.members}
            clients={props.clients}
            groups={props.groups}
            locations={props.locations}
            error={reportError}
            onSubmit={(body) =>
              void run(
                () =>
                  send(editingReport ? `/api/reports/${editingReport.id}` : "/api/reports", editingReport ? "PATCH" : "POST", body),
                setReportError,
                { success: editingReport ? "Report saved." : "Report created." }
              )
            }
          />
        ) : null}
        {drawer?.kind === "alert" && props.canManage ? (
          <AlertForm
            key={editingRule?.id ?? "new-rule"}
            rule={editingRule}
            channels={props.channels}
            members={props.members}
            clients={props.clients}
            groups={props.groups}
            locations={props.locations}
            error={alertError}
            onSubmit={(body) =>
              void run(
                () => send(editingRule ? `/api/alerts/${editingRule.id}` : "/api/alerts", editingRule ? "PATCH" : "POST", body),
                setAlertError,
                { success: editingRule ? "Alert rule saved." : "Alert rule created." }
              )
            }
          />
        ) : null}
      </ReportsDrawer>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={confirmDelete?.kind === "alert" ? "Delete this alert rule?" : "Delete this report?"}
        description={
          confirmDelete
            ? confirmDelete.kind === "alert"
              ? `“${confirmDelete.name}” stops checking. Past alert history stays.`
              : `“${confirmDelete.name}” stops sending. Its schedule is removed.`
            : ""
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          const target = confirmDelete;
          if (!target) return;
          await run(
            () => send(target.kind === "alert" ? `/api/alerts/${target.id}` : `/api/reports/${target.id}`, "DELETE"),
            target.kind === "alert" ? setAlertError : setReportError,
            { success: `“${target.name}” deleted.` }
          );
        }}
      />
    </div>
  );
}

function DeliveryList({ deliveries }: { deliveries: ReportRunRow["deliveries"] }) {
  if (deliveries.length === 0) return <span className="text-ink-3">No deliveries recorded</span>;
  return (
    <ul className="flex flex-col gap-1">
      {deliveries.map((delivery) => (
        <li key={`${delivery.channel}-${delivery.recipient}`} className="flex flex-wrap items-center gap-1.5 text-xs">
          <DeliveryStatusBadge status={delivery.status} />
          <span className="text-ink-2">{channelName(delivery.channel)}</span>
          <span className="text-ink-3">· {delivery.recipient}</span>
          {delivery.detail ? <span className="text-ink-3">· {delivery.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function RunTable({ runs, title, hint }: { runs: ReportRunRow[]; title: string; hint?: string }) {
  return (
    <Panel title={title} hint={hint} flush>
      {runs.length === 0 ? (
        <NoData>No runs yet. A test or a due schedule records one here.</NoData>
      ) : (
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Report</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Deliveries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((item) => (
              <TableRow key={item.id} className="align-top">
                <TableCell className="whitespace-normal align-top">
                  {item.reportId ? (
                    <Link href={`/reports/${item.reportId}`} className="font-medium text-ink hover:text-brand">
                      {item.reportName}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{item.reportName}</span>
                  )}
                  {item.summary ? <div className="text-xs text-ink-3">{item.summary}</div> : null}
                </TableCell>
                <TableCell className="align-top text-ink-2">{item.trigger === "test" ? "Test" : item.trigger === "schedule" ? "Schedule" : item.trigger}</TableCell>
                <TableCell className="align-top text-ink-2">
                  {formatWhen(item.startedAt)}
                  {item.attempts > 1 ? <div className="text-xs text-ink-3">Attempt {item.attempts}</div> : null}
                </TableCell>
                <TableCell className="align-top">
                  <RunStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  {item.error ? <p className="mb-1 text-xs text-bad">{item.error}</p> : null}
                  <DeliveryList deliveries={item.deliveries} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function AlertHistory({ events, title = "Alert history" }: { events: AlertEventRow[]; title?: string }) {
  return (
    <Panel title={title} hint="Most recent matches first." flush>
      {events.length === 0 ? (
        <NoData>No alerts have matched. A repeated check does not record the same event twice.</NoData>
      ) : (
        <ul className="divide-y divide-line-2">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-1.5 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{event.ruleName}</span>
                <span className="text-xs text-ink-3">{formatWhen(event.triggeredAt)}</span>
              </div>
              <p className="text-ink-2">{event.summary}</p>
              <DeliveryList deliveries={event.deliveries} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReportsDrawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/30 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-line bg-white shadow-overlay outline-none data-open:animate-in data-open:slide-in-from-right-8">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-semibold text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-ink-3">{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <X aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const FIELD = "mt-1 block h-[34px] w-full rounded-md border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line";
const LABEL = "block text-xs font-medium text-ink-2";
const CHECK = "size-4 shrink-0 accent-[#1F4ED8]";

function FormStep({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {index} · {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ScopeFields({
  scope,
  scopeId,
  onScope,
  onScopeId,
  options,
}: {
  scope: string;
  scopeId: string;
  onScope: (value: string) => void;
  onScopeId: (value: string) => void;
  options: ScopeOption[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={LABEL}>
        Scope
        <select
          className={FIELD}
          value={scope}
          onChange={(event) => {
            onScope(event.target.value);
            onScopeId("");
          }}
        >
          <option value="workspace">Whole workspace</option>
          <option value="client">Business</option>
          <option value="group">Group</option>
          <option value="location">Location</option>
        </select>
      </label>
      {scope !== "workspace" ? (
        <label className={LABEL}>
          {scope === "client" ? "Business" : scope === "group" ? "Group" : "Location"}
          <select className={FIELD} value={scopeId} onChange={(event) => onScopeId(event.target.value)}>
            <option value="">Choose</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function RecipientFields({
  members,
  selected,
  onChange,
}: {
  members: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p className={LABEL}>
        Recipients <span className="font-normal text-ink-3">· {selected.length} selected</span>
      </p>
      {members.length === 0 ? (
        <p className="mt-1 text-xs text-ink-3">No workspace members to choose from.</p>
      ) : (
        <div className="mt-1 flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2 text-[13px]">
          {members.map((email) => (
            <label key={email} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-paper">
              <input
                type="checkbox"
                className={CHECK}
                checked={selected.includes(email)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...selected, email] : selected.filter((item) => item !== email))
                }
              />
              <span className="truncate text-ink-2">{email}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportForm(props: {
  report: SavedReport | null;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const initialScope = props.report?.locationId
    ? "location"
    : props.report?.groupId
      ? "group"
      : props.report?.clientId
        ? "client"
        : "workspace";
  const [scope, setScope] = useState(initialScope);
  const [scopeId, setScopeId] = useState(props.report?.locationId ?? props.report?.groupId ?? props.report?.clientId ?? "");
  const [frequency, setFrequency] = useState(props.report?.frequency ?? "weekly");
  const [sections, setSections] = useState<string[]>(() => {
    const allowed = new Set<string>(REPORT_SECTIONS.map((section) => section.id));
    const saved = (props.report?.sections ?? ["scorecard", "trends", "leaderboard", "themes"]).filter((id) =>
      allowed.has(id)
    );
    return saved.length > 0 ? saved : ["scorecard"];
  });
  const [recipients, setRecipients] = useState<string[]>(props.report?.recipients ?? []);
  const [channels, setChannels] = useState<string[]>(
    (props.report?.channels ?? ["in_app"]).filter(
      (channel) => channel === "in_app" || props.channels.some((item) => item.id === channel && item.available)
    )
  );

  const options = scope === "client" ? props.clients : scope === "group" ? props.groups : props.locations;

  return (
    <form
      id="report-form"
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        props.onSubmit({
          name: String(form.get("name") ?? ""),
          scope,
          scopeId: scope === "workspace" ? null : scopeId || null,
          sections,
          frequency,
          deliveryTime: String(form.get("deliveryTime") ?? "09:00"),
          timezone: String(form.get("timezone") ?? "Asia/Kolkata"),
          weekday: frequency === "weekly" ? Number(form.get("weekday")) : null,
          dayOfMonth: frequency === "monthly" ? Number(form.get("dayOfMonth")) : null,
          recipients,
          channels,
          enabled: form.get("enabled") === "on",
        });
      }}
    >
      <FormStep index={1} title="What">
        <label className={LABEL}>
          Name
          <input name="name" required maxLength={80} defaultValue={props.report?.name ?? ""} className={FIELD} />
        </label>
        <div>
          <p className={LABEL}>Sections</p>
          <div className="mt-1 flex flex-col gap-1.5 text-[13px]">
            {REPORT_SECTIONS.map((section) => (
              <label key={section.id} className="flex items-center gap-2 text-ink-2">
                <input
                  type="checkbox"
                  className={CHECK}
                  checked={sections.includes(section.id)}
                  onChange={(event) =>
                    setSections((current) =>
                      event.target.checked ? [...current, section.id] : current.filter((item) => item !== section.id)
                    )
                  }
                />
                {section.label}
              </label>
            ))}
          </div>
        </div>
      </FormStep>

      <FormStep index={2} title="Scope">
        <ScopeFields scope={scope} scopeId={scopeId} onScope={setScope} onScopeId={setScopeId} options={options} />
        <p className="text-xs text-ink-3">Scope is fixed per report; it does not follow the scope bar.</p>
      </FormStep>

      <FormStep index={3} title="When">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={LABEL}>
            Frequency
            <select className={FIELD} value={frequency} onChange={(event) => setFrequency(event.target.value as SavedReport["frequency"])}>
              {REPORT_FREQUENCIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {frequency === "weekly" ? (
            <label className={LABEL}>
              Weekday
              <select name="weekday" defaultValue={props.report?.weekday ?? 1} className={FIELD}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {frequency === "monthly" ? (
            <label className={LABEL}>
              Day of month
              <input name="dayOfMonth" type="number" min={1} max={28} defaultValue={props.report?.dayOfMonth ?? 1} className={FIELD} />
            </label>
          ) : null}
          <label className={LABEL}>
            Delivery time
            <input name="deliveryTime" type="time" required defaultValue={props.report?.deliveryTime ?? "09:00"} className={FIELD} />
          </label>
        </div>
        <label className={LABEL}>
          Timezone
          <select name="timezone" defaultValue={props.report?.timezone ?? "Asia/Kolkata"} className={FIELD}>
            <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
            <option value="UTC">UTC</option>
            <option value="Asia/Dubai">Gulf (Asia/Dubai)</option>
            <option value="America/New_York">US Eastern (America/New_York)</option>
          </select>
        </label>
      </FormStep>

      <FormStep index={4} title="Who and how">
        <RecipientFields members={props.members} selected={recipients} onChange={setRecipients} />
        <ChannelFields channels={props.channels} selected={channels} onChange={setChannels} />
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="enabled" className={CHECK} defaultChecked={props.report?.enabled ?? true} />
          Schedule is on
        </label>
      </FormStep>
      {props.error ? (
        <Banner tone="bad" role="alert">
          {props.error}
        </Banner>
      ) : null}
    </form>
  );
}

function AlertForm(props: {
  rule: AlertRuleRow | null;
  channels: ChannelOption[];
  members: string[];
  clients: ScopeOption[];
  groups: ScopeOption[];
  locations: ScopeOption[];
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const initialScope = props.rule?.locationId ? "location" : props.rule?.groupId ? "group" : props.rule?.clientId ? "client" : "workspace";
  const [scope, setScope] = useState(initialScope);
  const [scopeId, setScopeId] = useState(props.rule?.locationId ?? props.rule?.groupId ?? props.rule?.clientId ?? "");
  const [kind, setKind] = useState(props.rule?.kind ?? "negative_reviews");
  const [recipients, setRecipients] = useState<string[]>(props.rule?.recipients ?? []);
  const [channels, setChannels] = useState<string[]>(
    (props.rule?.channels ?? ["in_app"]).filter(
      (channel) => channel === "in_app" || props.channels.some((item) => item.id === channel && item.available)
    )
  );
  const options = scope === "client" ? props.clients : scope === "group" ? props.groups : props.locations;
  const kindDetail = ALERT_KINDS.find((item) => item.id === kind)?.detail;

  return (
    <form
      id="alert-form"
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        props.onSubmit({
          name: String(form.get("name") ?? ""),
          kind,
          scope,
          scopeId: scope === "workspace" ? null : scopeId || null,
          enabled: form.get("enabled") === "on",
          recipients,
          channels,
          threshold: Number(form.get("threshold")),
          windowDays: Number(form.get("windowDays")),
          minReviews: Number(form.get("minReviews")),
          dropPoints: Number(form.get("dropPoints")),
          multiplier: Number(form.get("multiplier")),
        });
      }}
    >
      <FormStep index={1} title="Rule">
        <label className={LABEL}>
          Name
          <input name="name" required maxLength={80} defaultValue={props.rule?.name ?? ""} className={FIELD} />
        </label>
        <label className={LABEL}>
          Rule
          <select className={FIELD} value={kind} onChange={(event) => setKind(event.target.value as AlertRuleRow["kind"])}>
            {ALERT_KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-ink-3">{kindDetail}</p>
      </FormStep>

      <FormStep index={2} title="Scope">
        <ScopeFields scope={scope} scopeId={scopeId} onScope={setScope} onScopeId={setScopeId} options={options} />
      </FormStep>

      <FormStep index={3} title="Thresholds">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField name="threshold" label="Count" defaultValue={props.rule?.threshold ?? 3} />
          <NumberField name="windowDays" label="Window (days)" defaultValue={props.rule?.windowDays ?? 1} />
          <NumberField name="minReviews" label="Minimum reviews" defaultValue={props.rule?.minReviews ?? 5} />
          <NumberField name="dropPoints" label="Rating drop" step="0.1" defaultValue={props.rule?.dropPoints ?? 0.5} />
          <NumberField name="multiplier" label="Burst multiple" step="0.1" defaultValue={props.rule?.multiplier ?? 2} />
        </div>
      </FormStep>

      <FormStep index={4} title="Who and how">
        <RecipientFields members={props.members} selected={recipients} onChange={setRecipients} />
        <ChannelFields channels={props.channels} selected={channels} onChange={setChannels} />
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="enabled" className={CHECK} defaultChecked={props.rule?.enabled ?? true} />
          Rule is on
        </label>
      </FormStep>
      {props.error ? (
        <Banner tone="bad" role="alert">
          {props.error}
        </Banner>
      ) : null}
    </form>
  );
}

function NumberField({ name, label, defaultValue, step }: { name: string; label: string; defaultValue: number; step?: string }) {
  return (
    <label className={LABEL}>
      {label}
      <input name={name} type="number" step={step ?? "1"} required defaultValue={defaultValue} className={FIELD} />
    </label>
  );
}

function ChannelFields({
  channels,
  selected,
  onChange,
}: {
  channels: ChannelOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p className={LABEL}>Channels</p>
      <div className="mt-1 flex flex-col gap-1.5 text-[13px]">
        {channels.map((channel) => {
          const locked = channel.id === "in_app";
          const disabled = locked || !channel.available;
          return (
            <label key={channel.id} className={cn("flex items-start gap-2", disabled && !locked ? "text-ink-3" : "text-ink-2")}>
              <input
                type="checkbox"
                className={cn(CHECK, "mt-0.5")}
                checked={locked || selected.includes(channel.id)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, channel.id]
                      : selected.filter((item) => item !== channel.id)
                  )
                }
              />
              <span>
                {channelName(channel.id)}
                {locked ? <span className="text-xs text-ink-3"> · always on</span> : null}
                {!channel.available && channel.reason ? <span className="block text-xs text-ink-3">{channel.reason}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
