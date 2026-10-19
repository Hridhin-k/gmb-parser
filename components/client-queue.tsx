"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    return <p className="text-sm text-slate">No replies are waiting for this client.</p>;
  }

  return (
    <ul className="divide-y divide-silver rounded-xl border border-silver">
      {items.map((item) => (
        <li key={item.reviewId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span className="text-graphite">{item.label}</span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void decide(item.reviewId, "approved")}>Client approved</Button>
            <Button type="button" variant="outline" onClick={() => void decide(item.reviewId, "none")}>Remove</Button>
          </span>
        </li>
      ))}
      {error ? <li className="px-4 py-2 text-sm text-red-700">{error}</li> : null}
    </ul>
  );
}
