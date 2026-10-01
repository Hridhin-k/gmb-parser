import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/lib/services/dashboard";
import {
  MessageSquareText,
  AlertCircle,
  Pencil,
  Send,
  CheckCircle2,
  Star,
  MapPin,
} from "lucide-react";

interface DashboardStatsProps {
  kpis: DashboardKpis;
  basePath?: string;
}

function StatLink({
  href,
  label,
  value,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  value: string | number;
  icon: typeof Star;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-gray-200 bg-white px-3.5 py-3 shadow-none transition-colors hover:border-gray-300 hover:bg-gray-50/80"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
          {label}
        </p>
        <Icon className={cn("h-4 w-4 opacity-60", tone)} aria-hidden />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
        {value}
      </p>
    </Link>
  );
}

export function DashboardStats({
  kpis,
  basePath = "/dashboard",
}: DashboardStatsProps) {
  const maxBar = Math.max(
    1,
    ...Object.values(kpis.ratingDistribution)
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <StatLink
          href={`${basePath}?filter=all`}
          label="Reviews"
          value={kpis.totalReviews}
          icon={MessageSquareText}
          tone="text-blue-500"
        />
        <StatLink
          href={`${basePath}?filter=unanswered`}
          label="Needs reply"
          value={kpis.unanswered}
          icon={AlertCircle}
          tone={kpis.unanswered > 0 ? "text-orange-500" : "text-green-500"}
        />
        <StatLink
          href={`${basePath}#profiles`}
          label="Profiles open"
          value={kpis.profilesNeedingReply}
          icon={MapPin}
          tone={kpis.profilesNeedingReply > 0 ? "text-orange-500" : "text-gray-400"}
        />
        <StatLink
          href={`${basePath}?stars=negative`}
          label="Critical"
          value={kpis.criticalReviews}
          icon={AlertCircle}
          tone={kpis.criticalReviews > 0 ? "text-red-500" : "text-gray-400"}
        />
        <StatLink
          href={`${basePath}?filter=draft`}
          label="Drafts"
          value={kpis.drafts}
          icon={Pencil}
          tone="text-gray-500"
        />
        <StatLink
          href={`${basePath}?filter=approved`}
          label="Ready"
          value={kpis.approved}
          icon={Send}
          tone="text-blue-600"
        />
        <StatLink
          href={`${basePath}?filter=failed`}
          label="Failed"
          value={kpis.failed}
          icon={AlertCircle}
          tone={kpis.failed > 0 ? "text-red-500" : "text-gray-400"}
        />
        <StatLink
          href={`${basePath}?filter=published`}
          label="Published"
          value={kpis.published}
          icon={CheckCircle2}
          tone="text-green-600"
        />
        <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Avg / profiles
            </p>
            <Star className="h-4 w-4 text-amber-400 opacity-70" aria-hidden />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
            {kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—"}
            <span className="ml-1 text-sm font-normal text-gray-400">
              · {kpis.locationsActive}
            </span>
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[12px] font-medium text-gray-700">
            Rating distribution
          </p>
          <div className="mt-3 space-y-1.5">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const count = kpis.ratingDistribution[star];
              const pct = Math.round((count / maxBar) * 100);
              return (
                <Link
                  key={star}
                  href={`${basePath}?rating=${star}`}
                  className="group flex items-center gap-2"
                >
                  <span className="w-6 text-right text-[12px] tabular-nums text-gray-500">
                    {star}★
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all group-hover:bg-amber-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[12px] tabular-nums text-gray-500">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[12px] font-medium text-gray-700">Recent volume</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              href={`${basePath}?period=7d`}
              className="rounded-md bg-gray-50 px-3 py-2.5 hover:bg-gray-100"
            >
              <p className="text-[11px] uppercase tracking-wider text-gray-400">
                Last 7 days
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                {kpis.reviewsLast7d}
              </p>
            </Link>
            <Link
              href={`${basePath}?period=30d`}
              className="rounded-md bg-gray-50 px-3 py-2.5 hover:bg-gray-100"
            >
              <p className="text-[11px] uppercase tracking-wider text-gray-400">
                Last 30 days
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                {kpis.reviewsLast30d}
              </p>
            </Link>
            <Link
              href={`${basePath}?stars=negative`}
              className="rounded-md bg-red-50/70 px-3 py-2.5 hover:bg-red-50"
            >
              <p className="text-[11px] uppercase tracking-wider text-red-400">
                Critical (1–2★)
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-red-800">
                {kpis.ratingDistribution[1] + kpis.ratingDistribution[2]}
              </p>
            </Link>
            <Link
              href={`${basePath}?stars=positive`}
              className="rounded-md bg-emerald-50/70 px-3 py-2.5 hover:bg-emerald-50"
            >
              <p className="text-[11px] uppercase tracking-wider text-emerald-500">
                Positive (4–5★)
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-800">
                {kpis.ratingDistribution[4] + kpis.ratingDistribution[5]}
              </p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
