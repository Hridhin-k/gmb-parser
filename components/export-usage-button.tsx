"use client";

import { useState } from "react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";

export function ExportUsageButton({ href }: { href: string }) {
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
    <div className="mt-3 space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void download()}
        loading={state === "working"}
      >
        <FileSpreadsheet aria-hidden />
        {state === "working" ? "Preparing file…" : "Export for invoicing"}
      </Button>
      {state === "working" ? (
        <ActivityStatus
          title="Building the invoice file"
          detail="Collecting each client’s location count and reviews for the period selected above."
        />
      ) : null}
      {state === "error" ? (
        <p className="text-sm text-red-600" role="alert">
          The invoice file could not be built. Try again in a moment.
        </p>
      ) : null}
    </div>
  );
}
