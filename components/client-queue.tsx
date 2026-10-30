"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ClientQueue({
  clientId,
  items,
}: {
  clientId: string;
  items: Array<{ reviewId: string; label: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function decide(reviewId: string, decision: "approved" | "none") {
    setError(null);
    const response = await fetch(`/api/clients/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approval", reviewId, decision }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not update the queue.");
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="px-4 py-4 text-[13px] text-ink-3">No replies are waiting for this client.</p>;
  }

  return (
    <ul className="divide-y divide-line-2">
      {items.map((item) => (
        <li key={item.reviewId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
          <span className="flex min-w-0 items-center gap-2 text-ink-2">
            <Badge variant="brand">Awaiting client</Badge>
            <span className="truncate">{item.label}</span>
          </span>
          <span className="flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => void decide(item.reviewId, "approved")}>
              Client approved
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void decide(item.reviewId, "none")}>
              Remove
            </Button>
          </span>
        </li>
      ))}
      {error ? (
        <li className="px-4 py-2 text-[13px] text-bad" role="alert">
          {error}
        </li>
      ) : null}
    </ul>
  );
}
