import Link from "next/link";
import { ChartTip } from "@/components/charts";
import type { MobileOverview } from "@/lib/services/mobile-work";

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string | null;
}) {
  return (
    <div className="rounded-2xl border border-silver bg-white p-4">
      <p className="text-sm text-slate">{label}</p>
      <p className="mt-1 text-2xl font-medium text-ink">{value}</p>
      {detail ? <p className="mt-1 text-sm text-slate">{detail}</p> : null}
    </div>
  );
}

export function MobileOverviewView({ data }: { data: MobileOverview }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium text-ink">Overview</h1>
        <p className="mt-1 text-sm text-slate">{data.scopeLabel}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={data.sevenHref}
          aria-current={data.rangeKey === "7d" ? "page" : undefined}
          className={`inline-flex h-11 items-center rounded-full border px-4 text-sm ${data.rangeKey === "7d" ? "border-ink bg-ink text-white" : "border-silver bg-white text-ink"}`}
        >
          7 days
        </Link>
        <Link
          href={data.thirtyHref}
          aria-current={data.rangeKey === "30d" ? "page" : undefined}
          className={`inline-flex h-11 items-center rounded-full border px-4 text-sm ${data.rangeKey === "30d" ? "border-ink bg-ink text-white" : "border-silver bg-white text-ink"}`}
        >
          30 days
        </Link>
      </div>

      {data.chooseClient ? (
        <form method="get" action="/m" className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm text-slate">
            Client
            <select
              name="client"
              defaultValue={data.clientId ?? ""}
              className="mt-1 h-12 w-full rounded-lg border border-silver bg-white px-3 text-base text-ink"
            >
              {data.unknownClient ? <option value={data.clientId ?? ""}>Not in this view</option> : null}
              <option value="">All clients</option>
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
            className="h-12 shrink-0 rounded-full bg-ink px-4 text-sm font-medium text-white"
          >
            Apply
          </button>
        </form>
      ) : null}

      <section className="rounded-2xl border border-silver bg-white p-4">
        <h2 className="text-sm font-medium text-ink">This week</h2>
        <p className="mt-2 text-base leading-6 text-graphite">{data.brief}</p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Average rating" value={data.average} detail={data.ratingDelta} />
        <Metric label="Reply rate" value={data.replyRate} detail={data.replyDetail} />
        <Metric
          label="New reviews"
          value={data.newReviews.toLocaleString("en-US")}
          detail={data.reviewDelta}
        />
        <Metric
          label="Open escalations"
          value={data.openEscalations.toLocaleString("en-US")}
          detail={
            data.overdueEscalations > 0
              ? `${data.overdueEscalations} past the due time`
              : "None are past the due time"
          }
        />
      </div>

      <section className="rounded-2xl border border-silver bg-white p-4">
        <h2 className="text-sm font-medium text-ink">Needs attention</h2>
        {data.alerts.length === 0 ? (
          <p className="mt-2 text-sm text-slate">Nothing in this view needs attention.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.alerts.map((alert) => (
              <li key={alert.id}>
                <Link href={alert.href} className="block rounded-xl bg-paper px-3 py-3 text-sm text-ink">
                  {alert.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-silver bg-white p-4">
        <h2 className="text-sm font-medium text-ink">What customers are saying</h2>
        {data.themes.length === 0 ? (
          <p className="mt-2 text-sm text-slate">No complaint themes in this period.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.themes.map((theme) => (
              <li key={theme.id} className="group relative">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">{theme.label}</span>
                  <span className="text-slate">{theme.count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${theme.width}%` }} />
                </div>
                <ChartTip
                  title={`${theme.label} · ${theme.count.toLocaleString("en-US")}`}
                  lines={["1–3 star reviews with this theme"]}
                  stars={theme.stars}
                  className="bottom-full left-0 mb-1"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
