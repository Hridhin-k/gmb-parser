"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpDown, CheckCircle2, ShieldAlert, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageTabs } from "@/components/page-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StarRating } from "@/components/star-rating";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { SelectField } from "@/components/ui/select-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ESCALATION_LEVELS,
  escalationStatusLabel,
  ticketKey,
  type EscalationPolicy,
} from "@/lib/escalations";
import { themeLabel } from "@/lib/review-inbox";
import type { EscalationQueueItem } from "@/lib/services/escalations";

interface Member {
  userId: string;
  email: string;
  role: string;
  scopeLabel: string;
}

type Bucket = "needs_human" | "in_progress" | "past_sla" | "resolved";

export type EscalationBoardItem = EscalationQueueItem & {
  remaining: string | null;
  overdue: string | null;
  dueLabel: string;
  /** SLA ends within the next few hours. Computed on the server. */
  dueSoon?: boolean;
};

interface BoardProps {
  bucket: Bucket;
  counts: Record<Bucket, number>;
  items: EscalationBoardItem[];
  policy: EscalationPolicy;
  pauses: { workspace: boolean; clientIds: string[]; locationIds: string[] };
  clients: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; clientId: string | null }>;
  members: Member[];
  canManage: boolean;
  canEditRules?: boolean;
  query: string;
  /** Current text search (`q`), if any. */
  search?: string;
  page: number;
  /** Total cases in the current tab. */
  total?: number;
  totalPages: number;
}

const TABS: Array<{ id: Bucket; label: string }> = [
  { id: "needs_human", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "past_sla", label: "Overdue" },
  { id: "resolved", label: "Done" },
];

export function EscalationBoard(props: BoardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  async function send(url: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response) {
      setPending(false);
      setError("No connection. Nothing was saved. Check your network and try again.");
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      created?: number;
    };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "That change could not be saved.");
      return;
    }
    router.refresh();
  }

  async function start(item: EscalationBoardItem) {
    setStarting(item.id);
    setError(null);
    const response = await fetch(`/api/escalations/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => null);
    setStarting(null);
    if (!response) {
      setError("No connection. The follow-up was not started. Try again.");
      return;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "That follow-up could not be started.");
      return;
    }
    toast.success(`${ticketKey(item.ticketNo)} is in progress.`);
    router.refresh();
  }

  const hrefFor = (bucket: string, page = 1) => {
    const params = new URLSearchParams(props.query);
    params.set("queue", bucket);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const text = params.toString();
    return text ? `/escalations?${text}` : "/escalations";
  };

  const clearSearchHref = (() => {
    const params = new URLSearchParams(props.query);
    params.delete("q");
    params.delete("page");
    params.set("queue", props.bucket);
    return `/escalations?${params.toString()}`;
  })();

  const pageParams = new URLSearchParams(props.query);
  pageParams.set("queue", props.bucket);
  const sortedByOpened = new URLSearchParams(props.query).get("sort") === "opened";
  const open = props.counts.needs_human + props.counts.in_progress + props.counts.past_sla;

  return (
    <div className="space-y-4">
      <KpiGrid className="lg:grid-cols-4">
        <KpiTile
          label="To do"
          value={props.counts.needs_human.toLocaleString("en-US")}
          detail="Waiting for someone to start"
          href={hrefFor("needs_human")}
        />
        <KpiTile
          label="In progress"
          value={props.counts.in_progress.toLocaleString("en-US")}
          detail="Someone is handling these"
          href={hrefFor("in_progress")}
        />
        <KpiTile
          label="Overdue"
          value={props.counts.past_sla.toLocaleString("en-US")}
          detail={props.counts.past_sla > 0 ? "These need attention first" : "Nothing overdue"}
          href={hrefFor("past_sla")}
          tone={props.counts.past_sla > 0 ? "bad" : undefined}
        />
        <KpiTile
          label="Done"
          value={props.counts.resolved.toLocaleString("en-US")}
          detail="Handled and marked done"
          href={hrefFor("resolved")}
          tone={props.counts.resolved > 0 ? "ok" : undefined}
        />
      </KpiGrid>

      {error ? (
        <Banner tone="bad" title="Not saved.">
          {error}
        </Banner>
      ) : null}

      <PageTabs
        tabs={TABS.map((tab) => ({
          label: tab.label,
          href: hrefFor(tab.id),
          active: props.bucket === tab.id,
          count: props.counts[tab.id],
          tone: tab.id === "past_sla" && props.counts.past_sla > 0 ? "bad" : "default",
        }))}
      >
        <Link
          href={sortHref(props.query, props.bucket)}
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
        >
          <ArrowUpDown className="size-3.5" aria-hidden />
          {sortedByOpened ? "Sorted by opened time · sort by due" : "Soonest deadline first · sort by oldest"}
        </Link>
      </PageTabs>

      {props.search ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span>
            Matching <span className="font-medium text-ink">“{props.search}”</span>
          </span>
          <Link href={clearSearchHref} className="text-brand hover:underline">
            Clear search
          </Link>
        </div>
      ) : null}

      {props.items.length === 0 ? (
        props.search ? (
          <EmptyState
            icon={SearchX}
            title="No follow-ups match"
            description={`Nothing in ${TABS.find((tab) => tab.id === props.bucket)?.label ?? "this queue"} matches “${props.search}”.`}
          >
            <Link href={clearSearchHref} className={buttonVariants({ variant: "outline" })}>
              Clear filters
            </Link>
          </EmptyState>
        ) : (
          <EmptyState
            icon={props.bucket === "resolved" ? CheckCircle2 : ShieldAlert}
            title={props.bucket === "past_sla" ? "Nothing is overdue" : props.bucket === "resolved"
              ? "No completed follow-ups yet" : open === 0 ? "You’re all caught up"
                : props.bucket === "in_progress" ? "Nothing in progress" : "Nothing waiting to start"}
            description={emptyQueueCopy(props.bucket, props.counts, hrefFor)}
          >
            {props.bucket !== "resolved" && open === 0 && (props.canEditRules ?? props.canManage) ? (
              <Link href="/settings?section=sla" className={buttonVariants({ variant: "outline" })}>
                Change follow-up settings
              </Link>
            ) : null}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Customer review</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Who’s handling it</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.items.map((item) => (
                <TableRow key={item.id} id={`case-${item.id}`} className="scroll-mt-24">
                  <TableCell className="max-w-[22rem]">
                    <Link href={`/escalations/${item.id}`} className="text-ink hover:text-brand">
                      <span className="font-semibold">{item.reviewerName}</span>
                      <span className="ml-2 text-xs text-ink-3">{ticketKey(item.ticketNo)}</span>
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      <StarRating rating={item.starRating} />
                      {item.level !== "store" ? <LevelBadge level={item.level} /> : null}
                      {themeLabel(item.theme) ? <span>{themeLabel(item.theme)}</span> : null}
                      {item.comment ? <span className="truncate">“{item.comment}”</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-ink">{item.locationName}</span>
                    {item.groupName || item.clientName ? (
                      <span className="block text-xs text-ink-3">
                        {[item.groupName, item.clientName].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Owner members={props.members} userId={item.assignedTo} />
                  </TableCell>
                  <TableCell>
                    <SlaBadge item={item} />
                    <span className="mt-1 block text-xs text-ink-3">{item.dueLabel}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NextAction item={item} starting={starting === item.id} onStart={() => void start(item)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 text-xs text-ink-3">
            <span className="py-2">
              {typeof props.total === "number"
                ? `${props.total.toLocaleString("en-US")} ${props.total === 1 ? "follow-up" : "follow-ups"} in ${TABS.find((tab) => tab.id === props.bucket)?.label ?? "this queue"}`
                : null}
            </span>
            {props.totalPages > 1 ? (
              <PaginationBar
                basePath="/escalations"
                currentPage={props.page}
                totalPages={props.totalPages}
                searchParams={pageParams}
              />
            ) : null}
          </div>
        </div>
      )}

      {props.canManage ? (
        <details className="rounded-lg border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">Team and automatic reply controls</summary>
          <div className="mt-4">
            <PauseForm pauses={props.pauses} clients={props.clients} locations={props.locations}
              disabled={pending} onChange={(body) => send("/api/escalations/pause", body)} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  const label = ESCALATION_LEVELS.find((item) => item.id === level)?.label ?? level;
  return <Badge variant={level === "leadership" ? "bad" : level === "regional" ? "warn" : "default"}>{label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "resolved" ? "ok" : status === "in_progress" ? "info" : "default"}>
      {escalationStatusLabel(status)}
    </Badge>
  );
}

function SlaBadge({ item }: { item: EscalationBoardItem }) {
  if (item.status === "resolved") return <Badge variant="ok">Done</Badge>;
  if (item.overdue) return <Badge variant="bad">Overdue {item.overdue}</Badge>;
  if (item.remaining) {
    return <Badge variant={item.dueSoon ? "warn" : "default"}>Due in {item.remaining}</Badge>;
  }
  return <Badge>Due</Badge>;
}

function NextAction({
  item,
  starting,
  onStart,
}: {
  item: EscalationBoardItem;
  starting: boolean;
  onStart: () => void;
}) {
  const href = `/escalations/${item.id}`;
  if (item.status === "resolved") {
    return (
      <Link href={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        View
      </Link>
    );
  }
  if (item.status === "needs_human" && !item.overdue) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" loading={starting} onClick={onStart}>
          Start
        </Button>
        <Link href={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Open
        </Link>
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={buttonVariants({ variant: item.overdue ? "default" : "outline", size: "sm" })}
    >
      Open follow-up
    </Link>
  );
}

function Owner({ members, userId }: { members: Member[]; userId: string | null }) {
  if (!userId) return <span className="text-warn">Unassigned</span>;
  const member = members.find((item) => item.userId === userId);
  if (!member) return <span className="text-ink-3">A former member</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold uppercase text-brand"
      >
        {member.email.slice(0, 2)}
      </span>
      <span className="truncate text-ink-2">{member.email}</span>
    </span>
  );
}

function sortHref(query: string, bucket: string): string {
  const params = new URLSearchParams(query);
  params.set("queue", bucket);
  if (params.get("sort") === "opened") params.delete("sort");
  else params.set("sort", "opened");
  params.delete("page");
  const text = params.toString();
  return text ? `/escalations?${text}` : "/escalations";
}

function emptyQueueCopy(bucket: Bucket, counts: Record<Bucket, number>, hrefFor: (bucket: string) => string): ReactNode {
  const past = counts.past_sla;
  const open = counts.needs_human + counts.in_progress + counts.past_sla;
  if (bucket === "needs_human" && past > 0) {
    return (
      <>
        Nothing is waiting to be started within its deadline. {past} matching complaint
        {past === 1 ? " is" : "s are"} already overdue — open{" "}
        <Link href={hrefFor("past_sla")} className="font-medium text-brand underline">
          Overdue
        </Link>
        . Replying and marking a follow-up done are separate steps.
      </>
    );
  }
  if (bucket !== "resolved" && open === 0) {
    return "Reviews that need extra care appear here automatically. No need to create a follow-up yourself. Open a review, take care of the customer, then mark it done.";
  }
  if (bucket === "resolved") {
    return "Completed follow-ups will appear here after you mark them done.";
  }
  if (bucket === "past_sla") {
    return "No follow-ups in this view have passed their deadline.";
  }
  return "Reviews that match your follow-up settings appear here automatically. Reply to the customer, take any action needed, then mark the follow-up done.";
}

function PauseForm({
  pauses,
  clients,
  locations,
  disabled,
  onChange,
}: {
  pauses: BoardProps["pauses"];
  clients: BoardProps["clients"];
  locations: BoardProps["locations"];
  disabled: boolean;
  onChange: (body: { scope: string; clientId: string | null; locationId: string | null; paused: boolean }) => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const clientPaused = pauses.clientIds.includes(clientId);
  const locationPaused = pauses.locationIds.includes(locationId);
  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Pause automatic replies</h3>
        {pauses.workspace ? <Badge variant="warn">Workspace paused</Badge> : null}
      </div>
      <p className="text-xs leading-relaxed text-ink-3">
        A pause stops background reply generation for the selected scope, including work already waiting on the
        scheduler. People can still draft, approve, and publish by hand. There is no automatic sender running today.
      </p>
      <div className="flex flex-wrap items-center gap-2 border-t border-line-2 pt-3">
        <span className="min-w-0 flex-1 text-[13px] text-ink">Whole workspace</span>
        <Button
          type="button"
          size="sm"
          variant={pauses.workspace ? "secondary" : "outline"}
          disabled={disabled}
          onClick={() => onChange({ scope: "workspace", clientId: null, locationId: null, paused: !pauses.workspace })}
        >
          {pauses.workspace ? "Resume workspace" : "Pause workspace"}
        </Button>
      </div>
      {clients.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line-2 pt-3">
          <SelectField
            label="Business"
            value={clientId}
            onValueChange={setClientId}
            options={clients.map((client) => ({
              value: client.id,
              label: pauses.clientIds.includes(client.id) ? `${client.name} (paused)` : client.name,
            }))}
            className="min-w-0 flex-1"
            size="sm"
          />
          <Button
            type="button"
            size="sm"
            variant={clientPaused ? "secondary" : "outline"}
            disabled={disabled || !clientId}
            onClick={() => onChange({ scope: "client", clientId, locationId: null, paused: !clientPaused })}
          >
            {clientPaused ? "Resume business" : "Pause business"}
          </Button>
        </div>
      ) : null}
      {locations.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line-2 pt-3">
          <SelectField
            label="Location"
            value={locationId}
            onValueChange={setLocationId}
            options={locations.map((location) => ({
              value: location.id,
              label: pauses.locationIds.includes(location.id) ? `${location.name} (paused)` : location.name,
            }))}
            className="min-w-0 flex-1"
            size="sm"
          />
          <Button
            type="button"
            size="sm"
            variant={locationPaused ? "secondary" : "outline"}
            disabled={disabled || !locationId}
            onClick={() => onChange({ scope: "location", clientId: null, locationId, paused: !locationPaused })}
          >
            {locationPaused ? "Resume location" : "Pause location"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

