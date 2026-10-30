import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-sm border border-transparent px-2 text-xs font-medium leading-none whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-brand-line [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-paper text-ink-2",
        secondary: "bg-paper text-ink-2",
        brand: "bg-brand-tint text-brand",
        ok: "bg-ok-tint text-ok",
        warn: "bg-warn-tint text-warn",
        bad: "bg-bad-tint text-bad",
        destructive: "bg-bad-tint text-bad",
        ai: "bg-ai-tint text-ai",
        info: "bg-info-tint text-info",
        readonly: "bg-[#fde68a] text-demo-ink",
        outline: "border-line bg-white text-ink-2",
        ghost: "hover:bg-paper",
        link: "text-brand underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
