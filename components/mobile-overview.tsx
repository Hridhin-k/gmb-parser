import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MobileOverview } from "@/lib/services/mobile-work";
import { cn } from "@/lib/utils";

function Metric({ label, value, detail }: { label: string; value: string; detail: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums leading-tight text-ink">{value}</p>
      {detail ? <p className="mt-0.5 text-[13px] text-ink-3">{detail}</p> : null}
    </div>
  );
}

function TaskCard({
  href,
  tag,
  tone = "default",
  title,
  detail,
}: {
  href: string;
  tag: React.ReactNode;
  tone?: "default" | "bad" | "ai";
  title: string;
  detail?: string | null;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-lg border bg-white px-3.5 py-3 text-ink active:bg-paper",
        tone === "bad" ? "border-bad-line" : "border-line"
      )}
    >
      <Badge variant={tone === "bad" ? "bad" : tone === "ai" ? "ai" : "default"}>{tag}</Badge>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        {detail ? <span className="block text-[13px] text-ink-3">{detail}</span> : null}
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

const SEGMENT =
  "inline-flex h-12 flex-1 items-center justify-center rounded-md text-[15px] font-medium transition-colors";

export function MobileOverviewView({ data }: { data: MobileOverview }) {
  return (
    <div className="space-y-4 text-[15px]">
      <div>
        <h1 className="text-xl font-semibold text-ink">Overview</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {data.scopeLabel} · {data.rangeLabel}
        </p>
      </div>

      <nav aria-label="Period" className="flex gap-1 rounded-lg border border-line bg-white p-1">
        <Link
          href={data.sevenHref}
          aria-current={data.rangeKey === "7d" ? "page" : undefined}
          className={cn(SEGMENT, data.rangeKey === "7d" ? "bg-brand-tint text-brand" : "text-ink-2")}
        >
          7 days
        </Link>
        <Link
          href={data.thirtyHref}
          aria-current={data.rangeKey === "30d" ? "page" : undefined}
          className={cn(SEGMENT, data.rangeKey === "30d" ? "bg-brand-tint text-brand" : "text-ink-2")}
        >
          30 days
        </Link>
      </nav>

      {data.chooseClient ? (
        <form method="get" action="/m" className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-[13px] font-medium text-ink-2">
            Business
            <select
              name="client"
              defaultValue={data.clientId ?? ""}
              className="mt-1 h-12 w-full rounded-md border border-line bg-white px-3 text-[15px] text-ink"
            >
              {data.unknownClient ? <option value={data.clientId ?? ""}>Not in this view</option> : null}
              <option value="">All businesses</option>
              {data.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="range" value={data.rangeKey} />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-md bg-brand px-4 text-[15px] font-medium text-white hover:bg-brand-hover"
          >
            Apply
          </button>
        </form>
      ) : null}

      <section className="space-y-2" aria-labelledby="m-needs-you">
        <h2 id="m-needs-you" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Needs you now
        </h2>
        <TaskCard
          href={data.escalationsHref}
          tag={data.openEscalations.toLocaleString("en-US")}
          tone={data.overdueEscalations > 0 ? "bad" : "default"}
          title={data.openEscalations === 1 ? "Open case" : "Open cases"}
          detail={
            data.overdueEscalations > 0
              ? `${data.overdueEscalations.toLocaleString("en-US")} past the due time`
              : "None are past the due time"
          }
        />
        <TaskCard href={data.approveHref} tag="Drafts" tone="ai" title="Replies to approve" detail="Review, edit, then post" />
        {data.alerts.map((alert) => (
          <Link
            key={alert.id}
            href={alert.href}
            className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-white px-3.5 py-3 text-[15px] text-ink active:bg-paper"
          >
            <span className="min-w-0 flex-1">{alert.text}</span>
            <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
          </Link>
        ))}
        {data.alerts.length === 0 ? (
          <p className="px-1 text-[13px] text-ink-3">Nothing else in this view needs attention.</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-[15px] font-semibold text-ink">{data.rangeLabel}</h2>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
          <Metric label="Average rating" value={data.average} detail={data.ratingDelta} />
          <Metric label="Reply rate" value={data.replyRate} detail={data.replyDetail} />
          <Metric label="New reviews" value={data.newReviews.toLocaleString("en-US")} detail={data.reviewDelta} />
          <Metric
            label="Open escalations"
            value={data.openEscalations.toLocaleString("en-US")}
            detail={data.overdueEscalations > 0 ? `${data.overdueEscalations} overdue` : "None overdue"}
          />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-[15px] font-semibold text-ink">Summary</h2>
        <p className="mt-1.5 text-[15px] leading-6 text-ink-2">{data.brief}</p>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-[15px] font-semibold text-ink">What customers are saying</h2>
        {data.themes.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-ink-3">No complaint themes in this period.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.themes.map((theme) => (
              <li key={theme.id}>
                <div className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span className="text-ink">{theme.label}</span>
                  <span className="tabular-nums text-ink-3">{theme.count.toLocaleString("en-US")}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${theme.width}%` }} />
                </div>
                {theme.stars ? (
                  <p className="mt-1 text-xs tabular-nums text-ink-3">
                    {theme.stars
                      .slice(0, 3)
                      .map((count, index) => `${index + 1}★ ${count.toLocaleString("en-US")}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-3">Counts are 1–3 star reviews with each theme.</p>
      </section>
    </div>
  );
}
