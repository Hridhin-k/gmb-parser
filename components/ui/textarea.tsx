import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded border border-mist bg-white px-3 py-2 text-base text-charcoal-ink transition-colors outline-none placeholder:text-slate focus-visible:border-google-blue focus-visible:shadow-[0_0_0_1px_#c4c6c7] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
