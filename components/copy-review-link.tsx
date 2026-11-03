"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CopyState = "idle" | "copied" | "failed";

/** Clipboard write with a short "Copied" state. "failed" means show the text so it can be copied by hand. */
export function useCopyText() {
  const [state, setState] = useState<CopyState>("idle");

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return { state, copy, reset: () => setState("idle") };
}

export function CopyReviewLink({ url }: { url: string }) {
  const { state, copy } = useCopyText();

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copy(url)}>
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
          <label className="block text-xs text-ink-3">
            Copy this link
            <Input readOnly value={url} className="mt-1" onFocus={(event) => event.currentTarget.select()} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
