import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13px] font-medium leading-none whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none select-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover",
        outline:
          "border-line bg-white text-ink hover:bg-paper aria-expanded:bg-paper",
        secondary:
          "border-brand-line bg-brand-tint text-brand hover:bg-[#e2e9fc] aria-expanded:bg-[#e2e9fc]",
        ghost:
          "text-ink-2 hover:bg-paper hover:text-ink aria-expanded:bg-paper aria-expanded:text-ink",
        destructive:
          "border-bad-line bg-white text-bad hover:bg-bad-tint focus-visible:ring-bad-line",
        "destructive-solid":
          "border-bad bg-bad text-white hover:bg-[#991b1b]",
        ai: "border-ai-line bg-ai-tint text-ai hover:bg-[#e9e0fb] focus-visible:ring-ai-line",
        link: "h-auto border-0 px-0 text-brand underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[34px] gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-[18px] text-sm",
        icon: "size-[34px]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner in place of the leading icon and blocks clicks. */
    loading?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        buttonVariants({ variant, size, className }),
        loading && "[&>svg:first-of-type]:hidden"
      )}
      {...props}
    >
      {loading ? <Spinner size={size === "xs" || size === "sm" ? "sm" : "md"} /> : null}
      {children as React.ReactNode}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
