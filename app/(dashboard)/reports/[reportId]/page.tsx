import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { NoData, Panel } from "@/components/analytics-panel";
import { CHART, HBarChart } from "@/components/charts";
import { DeliveryStatusBadge, RunStatusBadge } from "@/components/reports-board";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REPORT_SECTIONS } from "@/lib/reporting";
import { guardReport, ReportService } from "@/lib/services/reporting";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { modernizeCopy } from "@/lib/ui/vocabulary";
import { validateId } from "@/lib/validation";

interface ReportPreviewProps {
  params: Promise<{ reportId: string }>;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const CHANNEL_NAMES: Record<string, string> = {
  in_app: "Saved in app",
  email: "Email",
  slack: "Slack",
  whatsapp: "WhatsApp",
};

interface Block {
  heading: string;
  lines: string[];
}

/**
 * The report document is a list of text lines (the same lines the PDF
 * prints). Split it into its sections so each can be shown in its own
 * panel; anything that does not match a known line shape is shown as text.
 */
function splitBlocks(lines: string[]): { intro: string[]; blocks: Block[] } {
  const intro: string[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;
  let expectHeading = false;
  for (const line of lines) {
    if (line.trim() === "") {
      expectHeading = true;
      continue;
    }
    if (expectHeading) {
      current = { heading: line, lines: [] };
      blocks.push(current);
      expectHeading = false;
      continue;
    }
    if (current) current.lines.push(line);
    else intro.push(line);
  }
  return { intro, blocks };
}

function parseTrends(block: Block) {
  const rows: Array<{ label: string; value: number; average: string }> = [];
  const other: string[] = [];
  for (const line of block.lines) {
    const match = /^(\d{4}-\d{2}):\s*(\d+)\s+reviews?,\s*average\s+(.+)$/.exec(line);
    if (match) rows.push({ label: match[1], value: Number(match[2]), average: match[3] });
    else other.push(line);
  }
  return { rows, other };
}

function parseLeaderboard(block: Block) {
  const rows: Array<{ rank: string; name: string; rating: string; reviews: string; reply: string }> = [];
  const other: string[] = [];
  for (const line of block.lines) {
    const match = /^(\d+)\.\s+(.+):\s+([^,]+),\s*(\d+)\s+reviews?,\s*reply rate\s+(.+)$/.exec(line);
    if (match) rows.push({ rank: match[1], name: match[2], rating: match[3], reviews: match[4], reply: match[5] });
    else other.push(line);
  }
  return { rows, other };
}

function parseThemes(block: Block) {
  const rows: Array<{ label: string; value: number }> = [];
  const other: string[] = [];
  for (const line of block.lines) {
    const match = /^(.+):\s*(\d+)$/.exec(line);
    if (match) rows.push({ label: match[1], value: Number(match[2]) });
    else other.push(line);
  }
  return { rows, other };
}

function monthLabel(key: string) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** One sentence per section, restating its own numbers. */
function finding(block: Block): string | null {
  if (block.heading === "Trends") {
    const { rows, other } = parseTrends(block);
    if (rows.length === 0) return other[0] ?? null;
    const busiest = rows.reduce((best, row) => (row.value > best.value ? row : best), rows[0]);
    return `${rows.length} ${rows.length === 1 ? "month" : "months"} in the period; the busiest was ${monthLabel(busiest.label)} with ${busiest.value.toLocaleString("en-US")} reviews (average ${busiest.average}).`;
  }
  if (block.heading === "Location leaderboard") {
    const { rows, other } = parseLeaderboard(block);
    if (rows.length === 0) return other[0] ?? null;
    return `Most reviewed location: ${rows[0].name}, ${Number(rows[0].reviews).toLocaleString("en-US")} reviews at ${rows[0].rating}, reply rate ${rows[0].reply}.`;
  }
  if (block.heading.startsWith("Themes")) {
    const { rows, other } = parseThemes(block);
    if (rows.length === 0) return other[0] ?? null;
    return `Most frequent theme in 1–3★ reviews: ${rows[0].label} (${rows[0].value.toLocaleString("en-US")}).`;
  }
  return block.lines[0] ?? null;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Scorecard({ block }: { block: Block }) {
  const pairs: Array<{ label: string; value: string }> = [];
  const notes: string[] = [];
  for (const line of block.lines) {
    const match = /^([^:]+):\s*(.+)$/.exec(line);
    if (match && !/^Previous window/.test(line) && match[2].length <= 16) pairs.push({ label: match[1], value: match[2] });
    else notes.push(line);
  }
  return (
    <div className="flex flex-col gap-2">
      {pairs.length > 0 ? (
        <KpiGrid>
          {pairs.map((pair) => (
            <KpiTile key={pair.label} label={pair.label} value={pair.value} />
          ))}
        </KpiGrid>
      ) : null}
      {notes.map((note, index) => (
        <p key={index} className="text-xs text-ink-3">
          {note}
        </p>
      ))}
    </div>
  );
}

function Trends({ block }: { block: Block }) {
  const { rows, other } = parseTrends(block);
  return (
    <Panel title="Reviews per month" hint="Bar length is the number of reviews; the figure after it is the average rating.">
      {rows.length === 0 ? (
        <NoData>{other[0] ?? "No months in this period."}</NoData>
      ) : (
        <HBarChart
          max={Math.max(1, ...rows.map((row) => row.value))}
          rows={rows.map((row) => ({
            id: row.label,
            label: monthLabel(row.label),
            value: row.value,
            color: CHART.blue,
            suffix: `reviews · avg ${row.average}`,
          }))}
        />
      )}
    </Panel>
  );
}

function Leaderboard({ block }: { block: Block }) {
  const { rows, other } = parseLeaderboard(block);
  return (
    <Panel title="Location leaderboard" hint="Top 20 locations by review count in this period." flush>
      {rows.length === 0 ? (
        <NoData>{other[0] ?? "No location has reviews in this period."}</NoData>
      ) : (
        <Table className="min-w-[32rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead className="text-right">Avg rating</TableHead>
              <TableHead className="text-right">Reply rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rank}>
                <TableCell className="text-ink-3">{row.rank}</TableCell>
                <TableCell className="max-w-[18rem] truncate font-medium text-ink">{row.name}</TableCell>
                <TableCell className="text-right">{Number(row.reviews).toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right">{row.rating}</TableCell>
                <TableCell className="text-right">{row.reply}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Themes({ block }: { block: Block }) {
  const { rows, other } = parseThemes(block);
  return (
    <Panel title={block.heading} hint="Reviews rated 1–3★ tagged with each theme.">
      {rows.length === 0 ? (
        <NoData>{other[0] ?? "No 1–3 star reviews in this period."}</NoData>
      ) : (
        <HBarChart
          max={Math.max(1, ...rows.map((row) => row.value))}
          rows={rows.map((row) => ({ label: row.label, value: row.value, color: CHART.rose, suffix: "reviews" }))}
        />
      )}
    </Panel>
  );
}

function TextBlock({ block }: { block: Block }) {
  return (
    <Panel title={block.heading}>
      <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
        {block.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function ReportPreviewPage({ params }: ReportPreviewProps) {
  const [{ user, workspaceId }, role] = await Promise.all([getActiveWorkspace(), getActiveRole()]);
  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    notFound();
  }
  const report = await ReportService.load(workspaceId, reportId);
  if (!report) notFound();
  try {
    await guardReport(user.id, workspaceId, report);
  } catch {
    notFound();
  }
  let document: Awaited<ReturnType<typeof ReportService.preview>>;
  try {
    document = await ReportService.preview(workspaceId, reportId);
  } catch {
    notFound();
  }
  // Run history for this report only (the list holds the workspace's 20 most recent runs).
  const history = await ReportService.list(workspaceId)
    .then((result) => result.runs.filter((run) => run.reportId === reportId))
    .catch(() => null);
  const lastRun = history?.[0] ?? null;
  const canManage = isManager(role);

  const { intro, blocks } = splitBlocks(document.lines);
  const scorecard = blocks.find((block) => block.heading === "Scorecard");
  const others = blocks.filter((block) => block !== scorecard);
  const schedule =
    report.frequency === "weekly"
      ? `${WEEKDAYS[report.weekday ?? 1] ?? "Weekly"}s at ${report.deliveryTime}`
      : report.frequency === "monthly"
        ? `Day ${report.dayOfMonth ?? 1} of each month at ${report.deliveryTime}`
        : `Daily at ${report.deliveryTime}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={document.name}
        breadcrumbs={[{ label: "Reports & alerts", href: "/reports" }, { label: document.name }]}
        description={`${modernizeCopy(document.scopeLabel)} · ${document.periodLabel} (${document.timezone}) · figures come from stored reviews`}
        eyebrow={
          <>
            {report.enabled ? <Badge variant="ok">Active</Badge> : <Badge>Paused</Badge>}
            {lastRun ? <RunStatusBadge status={lastRun.status} /> : <Badge>Not run yet</Badge>}
          </>
        }
      >
        {canManage ? (
          <Link href={`/reports?edit=${reportId}`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden />
            Edit schedule
          </Link>
        ) : null}
        <a href={`/api/reports/${reportId}/csv`} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden />
          CSV
        </a>
        <a href={`/api/reports/${reportId}/pdf`} className={buttonVariants({ variant: "default" })}>
          <Download aria-hidden />
          Download PDF
        </a>
      </PageHeader>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {scorecard ? <Scorecard block={scorecard} /> : null}
          <Panel title="Key findings" action={<Badge>Written from observed data</Badge>}>
            {document.lines.length === 0 ? (
              <NoData>This report has no content for the period.</NoData>
            ) : (
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed text-ink-2 marker:text-ink-3">
                {intro.map((line, index) => (
                  <li key={`intro-${index}`}>{line}</li>
                ))}
                {(scorecard?.lines ?? [])
                  .filter((line) => /^Previous window/.test(line))
                  .map((line, index) => (
                    <li key={`prev-${index}`}>{line}</li>
                  ))}
                {others.map((block) => {
                  const text = finding(block);
                  return text ? (
                    <li key={block.heading}>
                      <b className="font-medium text-ink">{block.heading}:</b> {text}
                    </li>
                  ) : null;
                })}
              </ol>
            )}
          </Panel>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {others.map((block) => {
              if (block.heading === "Trends") return <Trends key={block.heading} block={block} />;
              if (block.heading === "Location leaderboard")
                return (
                  <div key={block.heading} className="lg:col-span-2">
                    <Leaderboard block={block} />
                  </div>
                );
              if (block.heading.startsWith("Themes")) return <Themes key={block.heading} block={block} />;
              return <TextBlock key={block.heading} block={block} />;
            })}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title="Delivery" hint={lastRun ? `Last run ${formatWhen(lastRun.startedAt)}` : "No run recorded yet"}>
            {lastRun ? (
              <div className="flex flex-col gap-2">
                {lastRun.error ? <p className="text-xs text-bad">{lastRun.error}</p> : null}
                {lastRun.deliveries.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No deliveries recorded for this run.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lastRun.deliveries.map((delivery) => (
                      <li key={`${delivery.channel}-${delivery.recipient}`} className="flex items-start justify-between gap-2 text-[13px]">
                        <span className="min-w-0">
                          <span className="block truncate text-ink-2">{delivery.recipient}</span>
                          <span className="text-xs text-ink-3">
                            {CHANNEL_NAMES[delivery.channel] ?? delivery.channel}
                            {delivery.detail ? ` · ${delivery.detail}` : ""}
                          </span>
                        </span>
                        <DeliveryStatusBadge status={delivery.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">A test or the next scheduled send records deliveries here.</p>
            )}
          </Panel>

          <Panel title="Scope and schedule">
            <dl className="flex flex-col gap-1.5 text-[13px]">
              <div>
                <dt className="text-xs text-ink-3">Scope</dt>
                <dd className="text-ink-2">{modernizeCopy(document.scopeLabel)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Period shown</dt>
                <dd className="text-ink-2">{document.periodLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Schedule</dt>
                <dd className="text-ink-2">
                  {schedule} ({report.timezone}) · next {report.enabled ? formatWhen(report.nextRunAt) : "— paused"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Sections</dt>
                <dd className="text-ink-2">
                  {document.sections.map((id) => REPORT_SECTIONS.find((section) => section.id === id)?.label ?? id).join(", ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Recipients</dt>
                <dd className="text-ink-2">
                  {report.recipients.length === 0 ? "None" : report.recipients.join(", ")}
                  <span className="block text-xs text-ink-3">
                    {report.channels.map((channel) => CHANNEL_NAMES[channel] ?? channel).join(", ") || "Saved in app"}
                  </span>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Previous runs">
            {history === null ? (
              <p className="text-[13px] text-ink-3">Run history could not be loaded.</p>
            ) : history.length === 0 ? (
              <p className="text-[13px] text-ink-3">No runs yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.slice(0, 8).map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-ink-2">
                      {formatWhen(run.startedAt)}
                      <span className="block text-xs text-ink-3">{run.trigger === "test" ? "Test" : "Scheduled"}</span>
                    </span>
                    <RunStatusBadge status={run.status} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-3">The page shows the latest period. Earlier runs are not stored as documents.</p>
          </Panel>

          <Panel title="Export">
            <div className="flex flex-col gap-2">
              <a href={`/api/reports/${reportId}/pdf`} className={buttonVariants({ variant: "outline", className: "justify-between" })}>
                PDF <span className="text-ink-3">›</span>
              </a>
              <a href={`/api/reports/${reportId}/csv`} className={buttonVariants({ variant: "outline", className: "justify-between" })}>
                CSV <span className="text-ink-3">›</span>
              </a>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
