"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CopyReviewLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copy()}>
          {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {state === "copied" ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink className="size-3.5" />
          Open
        </Button>
      </div>
      {state === "failed" ? (
        <div className="w-full sm:w-80">
          <label className="block text-xs text-slate">
            Copy this link
            <Input readOnly value={url} className="mt-1" onFocus={(event) => event.currentTarget.select()} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
