import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[34px] w-full min-w-0 rounded-md border border-line bg-white px-3 text-[13px] text-ink transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-stone focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60 aria-invalid:border-bad aria-invalid:ring-2 aria-invalid:ring-bad-line",
        className
      )}
      {...props}
    />
  )
}

export { Input }
