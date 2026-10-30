"use client";

import { useState } from "react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExportUsageButton({
  href,
  variant = "default",
  className,
}: {
  href: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function download() {
    setState("working");
    try {
      const response = await fetch(href);
      if (!response.ok) {
        setState("error");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `grm-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-2 sm:items-end", className)}>
      <Button type="button" variant={variant} onClick={() => void download()} loading={state === "working"}>
        <FileSpreadsheet aria-hidden />
        {state === "working" ? "Preparing file…" : "Export for invoicing"}
      </Button>
      {state === "working" ? (
        <ActivityStatus
          title="Building the invoice file"
          detail="Collecting each business’s location count and reviews for the selected period."
        />
      ) : null}
      {state === "error" ? (
        <p className="text-xs text-bad" role="alert">
          The invoice file could not be built. Try again in a moment.
        </p>
      ) : null}
    </div>
  );
}
