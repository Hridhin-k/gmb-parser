import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-silver bg-white px-3 py-2 text-sm text-ink transition-colors outline-none placeholder:text-stone focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15 disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
