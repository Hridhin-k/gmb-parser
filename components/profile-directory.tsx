"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Star, Search, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProfileRow } from "@/lib/services/dashboard";

const SORT_OPTIONS = [
  { key: "attention", label: "Needs attention" },
  { key: "unanswered", label: "Unanswered" },
  { key: "rating", label: "Lowest rating" },
  { key: "reviews", label: "Most reviews" },
  { key: "name", label: "Name A–Z" },
] as const;

interface ProfileDirectoryProps {
  profiles: ProfileRow[];
  total: number;
  pageSize: number;
  currentPage: number;
  currentSort: string;
  currentQuery: string;
  selectedLocationId: string;
}

export function ProfileDirectory({
  profiles,
  total,
  pageSize,
  currentPage,
  currentSort,
  currentQuery,
  selectedLocationId,
}: ProfileDirectoryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(currentQuery);
  const [, startTransition] = useTransition();

  useEffect(() => setQ(currentQuery), [currentQuery]);

  useEffect(() => {
    if (q === currentQuery) return;
    const t = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (q) params.set("pq", q);
      else params.delete("pq");
      params.delete("pp");
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, currentQuery, pathname, router, searchParams]);

  function push(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function selectProfile(id: string) {
    push((params) => {
      if (selectedLocationId === id) {
        params.delete("location");
      } else {
        params.set("location", id);
        params.delete("page");
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      id="profiles"
      className="scroll-mt-4 space-y-2.5"
      aria-labelledby="profiles-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="profiles-heading"
            className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#18161a]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            Profiles
          </h2>
          <p className="text-sm font-light text-[#898b91]">
            {total.toLocaleString()} managed · search & sort · open one for AI
            insight + inbox
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search profiles…"
            className="h-10 w-full rounded-full border border-[#d9d2ff] bg-white pl-9 pr-4 text-sm text-[#18161a] placeholder:text-[#898b91] focus:border-[#4823ff] focus:outline-none focus:ring-2 focus:ring-[#ede9ff]"
            aria-label="Search profiles by name"
          />
        </div>
        <select
          value={currentSort}
          onChange={(e) =>
            push((params) => {
              params.set("psort", e.target.value);
              params.delete("pp");
            })
          }
          className="h-10 rounded-full border border-[#d9d2ff] bg-white px-4 text-sm text-[#18161a] focus:border-[#4823ff] focus:outline-none focus:ring-2 focus:ring-[#ede9ff]"
          aria-label="Sort profiles"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-[#d9d2ff] bg-white">
        <div className="max-h-[min(420px,50vh)] overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-[#eee] bg-[#fafaf8] text-[11px] font-medium uppercase tracking-[0.06em] text-[#898b91]">
              <tr>
                <th className="px-3 py-2 font-medium">Profile</th>
                <th className="px-2 py-2 font-medium tabular-nums">Avg</th>
                <th className="px-2 py-2 font-medium tabular-nums">Reviews</th>
                <th className="px-2 py-2 font-medium tabular-nums">Open</th>
                <th className="px-2 py-2 font-medium tabular-nums">1–2★</th>
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-gray-400"
                  >
                    No profiles match this search.
                  </td>
                </tr>
              ) : (
                profiles.map((p) => {
                  const selected = selectedLocationId === p.id;
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "cursor-pointer border-b border-[#ede9ff] transition-colors last:border-0",
                        selected
                          ? "bg-[#ede9ff] text-[#18161a]"
                          : "hover:bg-[#ede9ff]/40"
                      )}
                      onClick={() => selectProfile(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectProfile(p.id);
                        }
                      }}
                      tabIndex={0}
                      aria-selected={selected}
                    >
                      <td className="max-w-[220px] px-3 py-2">
                        <p
                          className={cn(
                            "truncate font-medium",
                            "text-[#18161a]"
                          )}
                        >
                          {p.title}
                        </p>
                        <p
                          className={cn(
                            "truncate text-[11px]",
                            "text-[#898b91]"
                          )}
                        >
                          {p.clientName ?? "—"}
                        </p>
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        <span className="inline-flex items-center gap-0.5">
                          {p.avgRating != null ? p.avgRating.toFixed(1) : "—"}
                          <Star
                            className={cn(
                              "h-3 w-3",
                              p.avgRating == null
                                ? "fill-[#eceae6] text-[#eceae6]"
                                : p.avgRating >= 4
                                  ? "fill-green-500 text-green-500"
                                  : p.avgRating >= 3
                                    ? "fill-yellow-400 text-yellow-500"
                                    : "fill-red-500 text-red-500"
                            )}
                            aria-hidden
                          />
                        </span>
                      </td>
                      <td className="px-2 py-2 tabular-nums">{p.reviewCount}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {p.unanswered > 0 ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 font-medium",
                              "text-amber-600"
                            )}
                          >
                            <AlertCircle className="h-3 w-3" aria-hidden />
                            {p.unanswered}
                          </span>
                        ) : (
                          <span
                            className={
                              "text-[#898b91]"
                            }
                          >
                            0
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {p.critical > 0 ? (
                          <span
                            className={
                              selected ? "text-red-300" : "text-red-600"
                            }
                          >
                            {p.critical}
                          </span>
                        ) : (
                          <span
                            className={
                              "text-[#898b91]"
                            }
                          >
                            0
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[12px] text-gray-500">
            <span>
              {(profileFromLabel(currentPage, pageSize) + 1).toLocaleString()}–
              {Math.min(currentPage * pageSize, total).toLocaleString()} of{" "}
              {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                onClick={() =>
                  push((params) => {
                    const next = currentPage - 1;
                    if (next <= 1) params.delete("pp");
                    else params.set("pp", String(next));
                  })
                }
                aria-label="Previous profiles page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums px-1">
                {currentPage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                onClick={() =>
                  push((params) => {
                    params.set("pp", String(currentPage + 1));
                  })
                }
                aria-label="Next profiles page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function profileFromLabel(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}
