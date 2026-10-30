import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Shared pieces for the platform admin screens (`/admin`). */

export function AdminCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  tone,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Use "p-0" for tables/lists that run edge to edge. */
  bodyClassName?: string;
  id?: string;
  tone?: "bad" | "warn";
}) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-4 rounded-lg border bg-white",
        tone === "bad" ? "border-bad-line" : tone === "warn" ? "border-warn-line" : "border-line",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function TenantStatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "ok" : status === "suspended" ? "warn" : status === "deleted" ? "bad" : "default";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

export function InviteStatusBadge({ status }: { status: string }) {
  const variant =
    status === "accepted" ? "ok" : status === "pending" ? "info" : status === "expired" ? "warn" : status === "revoked" ? "bad" : "default";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

export function ConnectionStatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "ok" : status === "expired" ? "warn" : status === "revoked" ? "bad" : "default";
  return <Badge variant={variant} className="capitalize">{status === "active" ? "Connected" : status}</Badge>;
}

export function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="default">Never synced</Badge>;
  const variant =
    status === "failed" ? "bad" : status === "partial" ? "warn" : status === "success" || status === "synced" || status === "completed" ? "ok" : status === "syncing" || status === "running" ? "info" : "default";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

export function formatAdminDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" });
}

export function money(value: number, digits = 2) {
  return `$${value.toFixed(digits)}`;
}
