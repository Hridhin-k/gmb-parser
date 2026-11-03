"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scopedHref } from "@/lib/shell";

/** Search every review from anywhere. ⌘K or Ctrl+K opens it. */
export function SidebarSearch({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setQuery(pathname === "/reviews" ? (searchParams.get("q") ?? "") : "");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    setOpen(false);
    onNavigate?.();
    if (pathname === "/reviews") {
      const params = new URLSearchParams(searchParams.toString());
      if (text) params.set("q", text);
      else params.delete("q");
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      return;
    }
    const params = new URLSearchParams();
    if (text) params.set("q", text);
    router.push(scopedHref(`/reviews${params.size ? `?${params}` : ""}`, searchParams, pathname));
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="flex h-9 w-full items-center gap-2 rounded-md bg-paper px-2.5 text-left text-[13px] text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-line"
        aria-label="Search reviews"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-line bg-white px-1.5 font-sans text-[11px] text-ink-3">⌘K</kbd>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(21.5rem,calc(100vw-1.5rem))] p-2">
        <form onSubmit={submit} role="search">
          <label className="relative block">
            <span className="sr-only">Search reviews, reviewers and replies</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reviews, reviewers, text…"
              className="h-9 w-full rounded-md border border-line bg-white pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line"
            />
          </label>
          <p className="px-1 pt-2 text-[11px] text-ink-3">Press Enter to see matching reviews in the current place.</p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
