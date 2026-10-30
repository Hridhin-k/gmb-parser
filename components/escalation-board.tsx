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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { SelectField } from "@/components/ui/select-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ESCALATION_LEVELS,
  ESCALATION_TIMEZONES,
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
  query: string;
  /** Current text search (`q`), if any. */
  search?: string;
  page: number;
  /** Total cases in the current tab. */
  total?: number;
  totalPages: number;
}

const TABS: Array<{ id: Bucket; label: string }> = [
  { id: "needs_human", label: "Needs human" },
  { id: "in_progress", label: "In progress" },
  { id: "past_sla", label: "Past SLA" },
  { id: "resolved", label: "Resolved" },
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
    if (url === "/api/escalations/policy") {
      const created = typeof payload.created === "number" ? payload.created : 0;
      if (created > 0) {
        toast.success(
          created === 1
            ? "Rules saved. Opened 1 matching case from synced reviews."
            : `Rules saved. Opened ${created} matching cases from synced reviews.`
        );
      } else {
        toast.success("Rules saved. No new matching cases in the recent synced reviews.");
      }
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
      setError("No connection. The case was not started. Try again.");
      return;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "That case could not be started.");
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
          label="Needs human"
          value={props.counts.needs_human.toLocaleString("en-US")}
          detail="Not started, inside the due window"
          href={hrefFor("needs_human")}
        />
        <KpiTile
          label="In progress"
          value={props.counts.in_progress.toLocaleString("en-US")}
          detail="Started, inside the due window"
          href={hrefFor("in_progress")}
        />
        <KpiTile
          label="Overdue"
          value={props.counts.past_sla.toLocaleString("en-US")}
          detail={props.counts.past_sla > 0 ? "Open and past the SLA" : "Nothing past the SLA"}
          href={hrefFor("past_sla")}
          tone={props.counts.past_sla > 0 ? "bad" : undefined}
        />
        <KpiTile
          label="Resolved"
          value={props.counts.resolved.toLocaleString("en-US")}
          detail="Resolution recorded"
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
          {sortedByOpened ? "Sorted by opened time · sort by due" : "Sorted by SLA deadline · sort by opened"}
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
            title="No cases match"
            description={`Nothing in ${TABS.find((tab) => tab.id === props.bucket)?.label ?? "this queue"} matches “${props.search}”.`}
          >
            <Link href={clearSearchHref} className={buttonVariants({ variant: "outline" })}>
              Clear filters
            </Link>
          </EmptyState>
        ) : (
          <EmptyState
            icon={props.bucket === "resolved" ? CheckCircle2 : ShieldAlert}
            title={props.bucket === "past_sla" ? "Nothing is overdue" : "Nothing in this queue"}
            description={emptyQueueCopy(props.bucket, props.counts, hrefFor)}
          >
            {props.bucket !== "resolved" && open === 0 && props.canManage ? (
              <a href="#rules" className={buttonVariants({ variant: "outline" })}>
                Review complaint rules
              </a>
            ) : null}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Level</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.items.map((item) => (
                <TableRow key={item.id} id={`case-${item.id}`} className="scroll-mt-24">
                  <TableCell>
                    <LevelBadge level={item.level} />
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    <Link href={`/escalations/${item.id}`} className="text-ink hover:text-brand">
                      <span className="font-semibold">{ticketKey(item.ticketNo)}</span>
                      <span className="text-ink-2"> · {item.reviewerName}</span>
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      <StarRating rating={item.starRating} />
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
                ? `${props.total.toLocaleString("en-US")} ${props.total === 1 ? "case" : "cases"} in ${TABS.find((tab) => tab.id === props.bucket)?.label ?? "this queue"}`
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
        <section id="rules" className="scroll-mt-24 space-y-3 pt-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Rules and pauses</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Which reviews open a case, when they are due, and where automatic replies are paused.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PolicyForm policy={props.policy} disabled={pending} onSave={(policy) => send("/api/escalations/policy", policy)} />
            <PauseForm
              pauses={props.pauses}
              clients={props.clients}
              locations={props.locations}
              disabled={pending}
              onChange={(body) => send("/api/escalations/pause", body)}
            />
          </div>
        </section>
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
  if (item.status === "resolved") return <Badge variant="ok">Resolved</Badge>;
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
      {item.assignedTo ? "Open case" : "Open and assign"}
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

const FIELD_LABEL = "flex flex-col gap-1 text-xs font-medium text-ink-2";

function PolicyForm({
  policy,
  disabled,
  onSave,
}: {
  policy: EscalationPolicy;
  disabled: boolean;
  onSave: (policy: EscalationPolicy) => void;
}) {
  const [draft, setDraft] = useState(policy);
  const [keywords, setKeywords] = useState(policy.extraKeywords.join(", "));
  const [reminders, setReminders] = useState(policy.reminderHours.join(", "));
  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const extraKeywords = keywords
          .split(",")
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        const reminderHours = reminders
          .split(",")
          .map((hour) => Number(hour.trim()))
          .filter((hour) => Number.isInteger(hour));
        onSave({ ...draft, extraKeywords, reminderHours });
      }}
    >
      <h3 className="text-sm font-semibold text-ink">Complaint rules</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={FIELD_LABEL}>
          Stars at or below
          <Input
            type="number"
            min={1}
            max={5}
            className="w-24"
            value={draft.maxStars}
            onChange={(event) => setDraft({ ...draft, maxStars: Number(event.target.value) })}
          />
        </label>
        <label className={FIELD_LABEL}>
          Due after hours
          <Input
            type="number"
            min={1}
            max={168}
            className="w-24"
            value={draft.dueHours}
            onChange={(event) => setDraft({ ...draft, dueHours: Number(event.target.value) })}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox
            checked={draft.flagProfanity}
            onCheckedChange={(checked) => setDraft({ ...draft, flagProfanity: checked === true })}
          />
          Flag profanity
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox
            checked={draft.flagLegalSafety}
            onCheckedChange={(checked) => setDraft({ ...draft, flagLegalSafety: checked === true })}
          />
          Flag legal or safety wording
        </label>
      </div>
      <label className={FIELD_LABEL}>
        Extra keywords, comma separated
        <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
      </label>
      <label className={FIELD_LABEL}>
        Reminder hours
        <Input value={reminders} onChange={(event) => setReminders(event.target.value)} />
      </label>
      <div className={FIELD_LABEL}>
        <span aria-hidden>Timezone for due times</span>
        <SelectField
        label="Timezone for due times"
        value={draft.timezone}
        onValueChange={(value) => setDraft({ ...draft, timezone: value as EscalationPolicy["timezone"] })}
        options={ESCALATION_TIMEZONES.map((zone) => ({ value: zone.id, label: zone.label }))}
      />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={disabled}>
          {disabled ? "Saving…" : "Save rules"}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">
        Saving scans recent synced reviews and opens cases that match these rules. Complaints already past the due
        window appear under Past SLA. Reminders are recorded in GRM. No email is sent.
      </p>
    </form>
  );
}

function emptyQueueCopy(bucket: Bucket, counts: Record<Bucket, number>, hrefFor: (bucket: string) => string): ReactNode {
  const past = counts.past_sla;
  const open = counts.needs_human + counts.in_progress + counts.past_sla;
  if (bucket === "needs_human" && past > 0) {
    return (
      <>
        No cases are still inside the due window. {past} matching complaint
        {past === 1 ? " is" : "s are"} already overdue — open{" "}
        <Link href={hrefFor("past_sla")} className="font-medium text-brand underline">
          Past SLA
        </Link>
        . Publishing a reply does not close an escalation.
      </>
    );
  }
  if (bucket !== "resolved" && open === 0) {
    return "No open cases yet. Save the complaint rules below to scan synced reviews, or wait for the next matching review. Publishing a reply does not close an escalation.";
  }
  if (bucket === "resolved") {
    return "No resolved cases in this view. Resolve a case from Needs human, In progress, or Past SLA.";
  }
  if (bucket === "past_sla") {
    return "Every open case in this view is still inside its due window.";
  }
  return "A review appears here when it matches the star threshold, profanity, legal or safety wording, or an extra keyword. Publishing a reply does not close an escalation.";
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

