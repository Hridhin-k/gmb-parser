"use client";

import { ReviewMedia } from "@/components/review-media";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronLeft, Phone, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InlineStars } from "@/components/reviews-badges";
import { PaginationBar } from "@/components/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { EscalationTicket } from "@/components/escalation-ticket";
import { ESCALATION_LEVELS, ticketKey, type EscalationPolicy } from "@/lib/escalations";
import type { ResolutionContact } from "@/lib/resolution-contact";
import type { EscalationQueueItem } from "@/lib/services/escalations";
import { FOLLOW_UP_QUEUES, isLowRating, nextOpenId, shortAge, type FollowUpQueue } from "@/components/reviews-status";
import { cn } from "@/lib/utils";

interface Member {
  userId: string;
  email: string;
  role: string;
  scopeLabel: string;
}

type Counts = Record<"needs_human" | "in_progress" | "past_sla" | "resolved", number>;

export type EscalationBoardItem = EscalationQueueItem & {
  remaining: string | null;
  overdue: string | null;
  dueLabel: string;
  /** SLA ends within the next few hours. Computed on the server. */
  dueSoon?: boolean;
};

interface BoardProps {
  bucket: FollowUpQueue;
  counts: Counts;
  items: EscalationBoardItem[];
  /** The case open on the right (from `id`, else the first in the list). */
  selected: EscalationBoardItem | null;
  contact: ResolutionContact;
  policy: EscalationPolicy;
  pauses: { workspace: boolean; clientIds: string[]; locationIds: string[] };
  clients: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; clientId: string | null }>;
  members: Member[];
  /** Who may receive the selected case. */
  assignees: string[];
  canManage: boolean;
  canEditRules?: boolean;
  canReassign: boolean;
  aiOnly?: boolean;
  /** Carried query (scope, period, `tab=follow-ups`). */
  query: string;
  /** Current text search (`q`), if any. */
  search?: string;
  page: number;
  /** Total cases in the current queue. */
  total?: number;
  totalPages: number;
}

/**
 * The Follow-ups tab of Reviews: customers who need a call back. A list on
 * the left, the open case on the right (a sheet on phones), with one-click
 * "Mark as called" and the full case below it.
 */
export function EscalationBoard(props: BoardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const selected = props.selected;
  // A case opened by tapping a row (it carries `id`) opens as a sheet on phones.
  const explicit = new URLSearchParams(props.query).has("id");
  const sheetOpen = Boolean(selected) && explicit && closedFor !== selected?.id;

  const hrefFor = (changes: { queue?: FollowUpQueue; id?: string | null; page?: number }) => {
    const params = new URLSearchParams(props.query);
    const queue = changes.queue ?? props.bucket;
    if (queue !== "open") params.set("queue", queue);
    else params.delete("queue");
    if (changes.id) params.set("id", changes.id);
    else params.delete("id");
    if (changes.page && changes.page > 1) params.set("page", String(changes.page));
    else if (changes.queue !== undefined) params.delete("page");
    return `/reviews?${params.toString()}`;
  };

  async function send(url: string, body: unknown): Promise<boolean> {
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
      return false;
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "That change could not be saved.");
      return false;
    }
    return true;
  }

  async function markCalled(item: EscalationBoardItem) {
    const ok = await send(`/api/escalations/${item.id}`, {
      action: "resolve",
      code: "handled",
      note: "Called the customer.",
    });
    if (!ok) return;
    toast.success(`Marked as called. ${item.reviewerName} is done.`);
    const openIds = props.items.filter((entry) => entry.status !== "resolved").map((entry) => entry.id);
    const next = nextOpenId(openIds, item.id);
    router.replace(hrefFor({ id: next }));
    router.refresh();
  }

  const queueCount: Record<FollowUpQueue, number> = {
    open: props.counts.needs_human + props.counts.in_progress + props.counts.past_sla,
    past_sla: props.counts.past_sla,
    resolved: props.counts.resolved,
  };
  const pageParams = new URLSearchParams(hrefFor({}).split("?")[1]);
  pageParams.delete("id");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FOLLOW_UP_QUEUES.map((queue) => {
          const active = queue.key === props.bucket;
          return (
            <Link
              key={queue.key}
              href={hrefFor({ queue: queue.key, id: null })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium",
                active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:bg-paper"
              )}
            >
              {queue.label}
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-white/80" : queue.key === "past_sla" && queueCount.past_sla > 0 ? "text-bad" : "text-ink-3"
                )}
              >
                {queueCount[queue.key].toLocaleString("en-US")}
              </span>
            </Link>
          );
        })}
        <span className="min-w-0 flex-[1_1_240px] text-xs text-ink-3">
          Added automatically for{" "}
          {props.policy.maxStars === 5
            ? "all reviews"
            : `reviews with ${props.policy.maxStars} ${props.policy.maxStars === 1 ? "star" : "stars"} or less`}
          , or when someone presses Needs a call. Due {props.policy.dueHours} hours after the review.
        </span>
      </div>

      {error ? (
        <Banner tone="bad" title="Not saved.">
          {error}
        </Banner>
      ) : null}

      {props.items.length === 0 && !selected ? (
        props.search ? (
          <EmptyState icon={SearchX} title="No follow-ups match" description={`Nothing here matches “${props.search}”.`} />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title={props.bucket === "resolved" ? "No completed call-backs yet" : props.bucket === "past_sla" ? "Nothing is overdue" : "No call-backs waiting"}
            description={
              props.bucket === "resolved"
                ? "Call-backs show here after you mark them as called."
                : "Use “Needs a call” on a review to add one. Low ratings are added for you."
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] xl:items-start">
          <section aria-label="Follow-up list" className="min-w-0 overflow-hidden rounded-xl border border-line bg-white">
            <ul>
              {props.items.map((item) => {
                const active = item.id === selected?.id;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "border-b border-line-2 last:border-b-0",
                      active ? "bg-[#f3f6fe] shadow-[inset_3px_0_0_var(--color-brand)]" : "bg-white"
                    )}
                  >
                    <Link
                      href={hrefFor({ id: item.id, page: props.page })}
                      scroll={false}
                      onClick={() => setClosedFor(null)}
                      aria-current={active ? "true" : undefined}
                      className="flex flex-col gap-2 px-4 py-3.5 pl-[46px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-line"
                    >
                      <span className="flex items-baseline gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.reviewerName}</span>
                        <span className="whitespace-nowrap text-xs text-ink-3">{shortAge(item.openedAt)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                        <InlineStars rating={item.starRating} />
                        <span className="truncate">{item.locationName}</span>
                      </span>
                      <span className={cn("line-clamp-2 text-[13px] leading-[1.45]", item.comment ? "text-ink-2" : "italic text-ink-3")}>
                        {item.comment || "Rating only. No written comment."}
                      </span>
                      <span className="flex min-h-[34px] items-center">
                        <CaseLine item={item} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {props.totalPages > 1 ? (
              <div className="border-t border-line px-3 text-xs">
                <PaginationBar basePath="/reviews" currentPage={props.page} totalPages={props.totalPages} searchParams={pageParams} />
              </div>
            ) : null}
          </section>

          {selected ? (
            <>
              {sheetOpen ? (
                <div className="fixed inset-0 z-40 bg-ink/30 xl:hidden" role="presentation" onClick={() => setClosedFor(selected.id)} />
              ) : null}
              <section
                aria-label="Selected follow-up"
                className={cn(
                  "min-w-0 bg-white xl:sticky xl:top-[84px] xl:block xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto xl:rounded-xl xl:border xl:border-line xl:p-6",
                  sheetOpen
                    ? "fixed inset-x-0 bottom-0 top-8 z-50 overflow-y-auto rounded-t-2xl p-4 pb-8 shadow-[0_-8px_24px_rgba(20,24,31,0.12)] sm:p-6 xl:inset-auto xl:z-auto xl:shadow-none"
                    : "hidden"
                )}
              >
                <CaseDetail
                  key={selected.id}
                  item={selected}
                  props={props}
                  pending={pending}
                  onMarkCalled={() => void markCalled(selected)}
                  onClose={() => setClosedFor(selected.id)}
                />
              </section>
            </>
          ) : null}
        </div>
      )}

      {props.canManage ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">Team and automatic reply controls</summary>
          <div className="mt-4">
            <PauseForm
              pauses={props.pauses}
              clients={props.clients}
              locations={props.locations}
              disabled={pending}
              onChange={(body) =>
                void send("/api/escalations/pause", body).then((ok) => {
                  if (ok) router.refresh();
                })
              }
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CaseLine({ item }: { item: EscalationBoardItem }) {
  if (item.status === "resolved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
        <CheckCircle2 className="size-[13px]" aria-hidden />
        Called · done
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", item.overdue ? "text-bad" : "text-info")}>
      <Phone className="size-[13px]" aria-hidden />
      {item.overdue ? `Call back · overdue ${item.overdue}` : `Call back · due ${item.dueLabel}`}
    </span>
  );
}

function CaseDetail({
  item,
  props,
  pending,
  onMarkCalled,
  onClose,
}: {
  item: EscalationBoardItem;
  props: BoardProps;
  pending: boolean;
  onMarkCalled: () => void;
  onClose: () => void;
}) {
  const open = item.status !== "resolved";
  const owner = item.assignedTo ? (props.members.find((member) => member.userId === item.assignedTo)?.email ?? "A former member") : null;
  const tag = !open
    ? { label: "Done", className: "bg-ok-tint text-ok" }
    : item.overdue
      ? { label: "Overdue", className: "bg-bad-tint text-bad" }
      : { label: "Call back", className: "bg-info-tint text-info" };
  const levelLabel = ESCALATION_LEVELS.find((level) => level.id === item.level)?.label;
  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onClose}
        className="-mt-1 inline-flex h-11 items-center gap-1 self-start text-sm font-medium text-ink-2 xl:hidden"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All follow-ups
      </button>
      <div className="flex flex-wrap items-start gap-3.5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-line-2 text-sm font-semibold text-ink-2"
        >
          {item.reviewerName
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <span className="text-base font-semibold text-ink">{item.reviewerName}</span>
          <span className="text-[13px] text-ink-3">
            {[item.locationName, item.groupName, item.clientName].filter(Boolean).join(" · ")} · {ticketKey(item.ticketNo)}
          </span>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tag.className)}>{tag.label}</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span role="img" aria-label={`${item.starRating} out of 5 stars`} className="text-lg tracking-[2px] text-star">
            {"★".repeat(item.starRating)}
            <span className="text-[#d5d9e0]">{"★".repeat(Math.max(0, 5 - item.starRating))}</span>
          </span>
          {isLowRating(item.starRating) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-bad-tint px-2 py-0.5 text-[11px] font-semibold text-bad">
              <AlertCircle className="size-3" aria-hidden />
              Low rating
            </span>
          ) : null}
          {item.level !== "store" && levelLabel ? (
            <Badge variant={item.level === "leadership" ? "bad" : "warn"}>{levelLabel} team</Badge>
          ) : null}
        </div>
        {item.comment ? (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{item.comment}</p>
        ) : (
          <p className="text-[15px] italic text-ink-3">Rating only. No written comment.</p>
        )}
        <ReviewMedia items={item.reviewMediaItems} replyUrl={item.reviewUrl} />
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-info-line bg-info-tint p-4 text-[13px] text-[#0b4f61]">
          <span className="flex flex-col gap-0.5">
            <span className="text-xs">Owner</span>
            <span className={cn("font-semibold", !owner && "text-warn")}>{owner ?? "Unassigned"}</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-xs">Due</span>
            <span className={cn("font-semibold", item.overdue && "text-bad")}>
              {item.overdue ? `Overdue ${item.overdue}` : item.dueLabel}
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-xs">Phone</span>
            {props.contact.phone ? (
              <a href={`tel:${props.contact.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-[#0b4f61] hover:underline">
                {props.contact.phone}
              </a>
            ) : (
              <Link href="/settings?section=sla" className="font-semibold text-[#0b4f61] underline">
                Add a callback number
              </Link>
            )}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            loading={pending}
            onClick={onMarkCalled}
            className="h-11 rounded-full border-ink bg-ink px-5 text-sm font-semibold hover:border-graphite hover:bg-graphite"
          >
            Mark as called
          </Button>
        </div>
      ) : null}

      <EscalationTicket
        item={item}
        contact={props.contact}
        members={props.members}
        assignees={props.assignees}
        canManage={props.canManage}
        canReassign={props.canReassign}
        aiOnly={props.aiOnly}
      />
    </div>
  );
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

