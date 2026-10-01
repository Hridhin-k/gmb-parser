import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/lib/services/dashboard";
import { ratingBarClass, ratingTextClass } from "@/lib/ui/rating-color";
import {
  MessageSquareText,
  AlertCircle,
  Pencil,
  Send,
  CheckCircle2,
  Star,
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
      className="rounded-[20px] border border-[#e4e2de] bg-white p-5 transition-colors hover:border-[#18161a]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
          {label}
        </p>
        <Icon className={cn("h-4 w-4 text-[#18161a]", tone)} aria-hidden />
      </div>
      <p
        className="mt-3 text-[31px] leading-none tracking-[-0.032em] text-[#18161a]"
        style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
      >
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
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink
          href={`${basePath}?filter=unanswered`}
          label="Needs reply"
          value={kpis.unanswered}
          icon={AlertCircle}
        />
        <StatLink
          href={`${basePath}?stars=negative`}
          label="Critical"
          value={kpis.criticalReviews}
          icon={AlertCircle}
        />
        <StatLink
          href={`${basePath}?filter=approved`}
          label="Ready"
          value={kpis.approved}
          icon={Send}
        />
        <StatLink
          href={`${basePath}?filter=failed`}
          label="Failed"
          value={kpis.failed}
          icon={AlertCircle}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink
          href={`${basePath}?filter=all`}
          label="Reviews"
          value={kpis.totalReviews}
          icon={MessageSquareText}
        />
        <StatLink
          href={`${basePath}?filter=draft`}
          label="Drafts"
          value={kpis.drafts}
          icon={Pencil}
        />
        <StatLink
          href={`${basePath}?filter=published`}
          label="Published"
          value={kpis.published}
          icon={CheckCircle2}
        />
        <div className="rounded-[20px] border border-[#e4e2de] bg-white p-5">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
            Average
          </p>
          <p
            className="mt-3 text-[31px] leading-none tracking-[-0.032em] text-[#18161a]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            {kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—"}
            <span className="ml-2 text-base font-light text-[#898b91]">
              {kpis.locationsActive} profiles
            </span>
          </p>
          <Link
            href={`${basePath}#profiles`}
            className="mt-3 inline-block text-sm font-medium text-[#4823ff]"
          >
            {kpis.profilesNeedingReply} still open
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-[20px] border border-[#e4e2de] bg-white p-5">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
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
                  <span className={cn("w-6 text-right text-[12px] tabular-nums", ratingTextClass(star))}>
                    {star}★
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#f3f1ee]">
                    <div
                      className={cn("h-full rounded-full transition-opacity group-hover:opacity-80", ratingBarClass(star))}
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

        <div className="rounded-[20px] border border-[#e4e2de] bg-white p-5">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
            Recent volume
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              href={`${basePath}?period=7d`}
              className="rounded-[12px] bg-[#f3f1ee]/60 px-3 py-3 hover:bg-[#f3f1ee]"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#898b91]">
                Last 7 days
              </p>
              <p className="mt-1 text-[22px] leading-none tracking-[-0.02em] text-[#18161a]" style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
                {kpis.reviewsLast7d}
              </p>
            </Link>
            <Link
              href={`${basePath}?period=30d`}
              className="rounded-[12px] bg-[#f3f1ee]/60 px-3 py-3 hover:bg-[#f3f1ee]"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#898b91]">
                Last 30 days
              </p>
              <p className="mt-1 text-[22px] leading-none tracking-[-0.02em] text-[#18161a]" style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
                {kpis.reviewsLast30d}
              </p>
            </Link>
            <Link
              href={`${basePath}?stars=negative`}
              className="rounded-[12px] border border-[#e4e2de] px-3 py-3 hover:border-[#18161a]"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                Critical (1–2★)
              </p>
              <p className="mt-1 text-[22px] leading-none tracking-[-0.02em] text-[#18161a]" style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
                {kpis.ratingDistribution[1] + kpis.ratingDistribution[2]}
              </p>
            </Link>
            <Link
              href={`${basePath}?stars=positive`}
              className="rounded-[12px] border border-[#e4e2de] px-3 py-3 hover:border-[#18161a]"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                Positive (4–5★)
              </p>
              <p className="mt-1 text-[22px] leading-none tracking-[-0.02em] text-[#18161a]" style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
                {kpis.ratingDistribution[4] + kpis.ratingDistribution[5]}
              </p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
