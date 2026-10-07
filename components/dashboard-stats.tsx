import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/lib/services/dashboard";

interface DashboardStatsProps {
  kpis: DashboardKpis;
  basePath?: string;
}

function Metric({
  href,
  label,
  value,
  hint,
  valueClassName,
}: {
  href: string;
  label: string;
  value: string | number;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <Link href={href} className="px-4 py-3 hover:bg-paper">
      <p className="text-xs text-slate">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[26px] leading-none text-graphite",
          valueClassName
        )}
        style={{ fontFamily: "var(--font-heading), sans-serif" }}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate">{hint}</p> : null}
    </Link>
  );
}

function starBar(star: number) {
  if (star >= 4) return { bar: "bg-green-500", track: "bg-green-100" };
  if (star === 3) return { bar: "bg-yellow-400", track: "bg-yellow-100" };
  return { bar: "bg-red-500", track: "bg-red-100" };
}

export function DashboardStats({
  kpis,
  basePath = "/dashboard",
}: DashboardStatsProps) {
  const maxBar = Math.max(1, ...Object.values(kpis.ratingDistribution));
  const average =
    kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—";
  const averageClass =
    kpis.avgRating == null
      ? undefined
      : kpis.avgRating >= 4
        ? "text-green-600"
        : kpis.avgRating >= 3
          ? "text-yellow-600"
          : "text-red-600";
  const criticalStars = kpis.ratingDistribution[1] + kpis.ratingDistribution[2];
  const positiveStars = kpis.ratingDistribution[4] + kpis.ratingDistribution[5];

  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="grid grid-cols-2 divide-x divide-y divide-[#eee] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          href={`${basePath}?filter=unanswered`}
          label="Needs reply"
          value={kpis.unanswered}
          hint={
            kpis.profilesNeedingReply > 0
              ? `${kpis.profilesNeedingReply} profile${kpis.profilesNeedingReply === 1 ? "" : "s"}`
              : undefined
          }
          valueClassName={kpis.unanswered > 0 ? "text-amber-600" : undefined}
        />
        <Metric
          href={`${basePath}?stars=negative`}
          label="Critical"
          value={kpis.criticalReviews}
          valueClassName={kpis.criticalReviews > 0 ? "text-red-600" : undefined}
        />
        <Metric
          href={`${basePath}?filter=approved`}
          label="Ready"
          value={kpis.approved}
          valueClassName={kpis.approved > 0 ? "text-green-600" : undefined}
        />
        <Metric
          href={`${basePath}?filter=failed`}
          label="Failed"
          value={kpis.failed}
          valueClassName={kpis.failed > 0 ? "text-red-600" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[#eee] border-t border-[#eee] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          href={`${basePath}?filter=all`}
          label="Reviews"
          value={kpis.totalReviews}
        />
        <Metric
          href={`${basePath}?filter=draft`}
          label="Drafts"
          value={kpis.drafts}
        />
        <Metric
          href={`${basePath}?filter=published`}
          label="Published"
          value={kpis.published}
          valueClassName={kpis.published > 0 ? "text-green-600" : undefined}
        />
        <Metric
          href={`${basePath}#profiles`}
          label="Average"
          value={average}
          hint={`${kpis.locationsActive} profiles`}
          valueClassName={averageClass}
        />
      </div>

      <div className="grid border-t border-[#eee] lg:grid-cols-[1.35fr_1fr]">
        <div className="px-4 py-3">
          <p className="text-xs text-slate">Rating distribution</p>
          <div className="mt-2 space-y-1">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const count = kpis.ratingDistribution[star];
              const pct = Math.round((count / maxBar) * 100);
              const colors = starBar(star);
              return (
                <Link
                  key={star}
                  href={`${basePath}?rating=${star}`}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-paper"
                >
                  <span
                    className={cn(
                      "w-7 text-right text-xs tabular-nums",
                      star >= 4
                        ? "text-green-600"
                        : star === 3
                          ? "text-yellow-600"
                          : "text-red-600"
                    )}
                  >
                    {star}★
                  </span>
                  <div
                    className={cn(
                      "h-1.5 flex-1 overflow-hidden rounded-full",
                      colors.track
                    )}
                  >
                    <div
                      className={cn("h-full rounded-full", colors.bar)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-graphite">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-[#eee] lg:border-t-0 lg:border-l">
          <Metric
            href={basePath}
            label="Last 7 days"
            value={kpis.reviewsLast7d}
          />
          <Metric
            href={`${basePath}?range=1m`}
            label="Last 30 days"
            value={kpis.reviewsLast30d}
          />
          <Metric
            href={`${basePath}?stars=negative`}
            label="1–2★"
            value={criticalStars}
            valueClassName={criticalStars > 0 ? "text-red-600" : undefined}
          />
          <Metric
            href={`${basePath}?stars=positive`}
            label="4–5★"
            value={positiveStars}
            valueClassName={positiveStars > 0 ? "text-green-600" : undefined}
          />
        </div>
      </div>
    </section>
  );
}
