import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink transition-colors outline-none placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
