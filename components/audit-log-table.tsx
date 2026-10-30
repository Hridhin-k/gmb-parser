"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AuditTableRow {
  id: string;
  time: string;
  timeLabel: string;
  actor: string;
  actorKind: "person" | "system" | "former";
  action: string;
  actionLabel: string;
  tone: "ok" | "bad" | "info" | "default";
  objectLabel: string;
  objectId: string | null;
  objectHref: string | null;
  details: Array<{ label: string; value: string }>;
}

function initials(label: string) {
  const name = label.split("@")[0] ?? label;
  const parts = name.split(/[.\s_+-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** The current page of the audit log, with a quick text search over that page. */
export function AuditLogTable({ rows, summary }: { rows: AuditTableRow[]; summary: string }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? rows.filter((row) =>
            [row.actor, row.actionLabel, row.action, row.objectLabel, row.objectId ?? "", ...row.details.map((d) => `${d.label} ${d.value}`)]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          )
        : rows,
    [rows, needle]
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this page: person, action, ID…"
            aria-label="Search this page of the audit log"
            className="h-8 pl-8"
          />
        </div>
        <span className="text-xs text-ink-3" aria-live="polite">
          {needle ? `${visible.length} of ${rows.length} on this page match · ` : ""}
          {summary}
        </span>
      </div>
      {visible.length === 0 ? (
        <EmptyState bare icon={Search} title="Nothing on this page matches" description="Search only covers the entries on this page. Use the filters above to narrow the whole log.">
          <button type="button" className="text-[13px] font-medium text-brand hover:text-brand-hover" onClick={() => setQuery("")}>
            Clear search
          </button>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-[13px]">
            <thead className="bg-[#fafbfc] text-xs text-ink-3">
              <tr className="border-b border-line">
                <th className="w-44 px-3 py-2 font-medium">Time</th>
                <th className="w-56 px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Object</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-line-2 align-top last:border-0 hover:bg-[#fafbfd]">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-ink-3">
                    <time dateTime={row.time}>{row.timeLabel}</time>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                          row.actorKind === "person" ? "bg-[#dde3ee] text-ink-2" : "bg-paper text-ink-3"
                        )}
                        aria-hidden
                      >
                        {row.actorKind === "system" ? <Bot className="size-3.5" /> : initials(row.actor)}
                      </span>
                      <span className={cn("max-w-[13rem] truncate", row.actorKind === "person" ? "text-ink" : "text-ink-3")}>{row.actor}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={row.tone}>{row.actionLabel}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.objectHref ? (
                      <Link href={row.objectHref} className="font-medium text-ink hover:text-brand">
                        {row.objectLabel}
                      </Link>
                    ) : (
                      <span className="text-ink-2">{row.objectLabel}</span>
                    )}
                    {row.objectId ? <span className="block font-mono text-[11px] text-ink-3">{row.objectId.slice(0, 8)}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-3">
                    {row.details.length === 0 ? (
                      "—"
                    ) : (
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {row.details.map((detail) => (
                          <span key={detail.label}>
                            {detail.label}: <span className="text-ink-2">{detail.value}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
