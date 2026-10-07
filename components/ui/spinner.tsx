import { cn } from "@/lib/utils";

const SIZE = {
  xs: "size-3 border-[1.5px]",
  sm: "size-3.5 border-2",
  md: "size-4 border-2",
  lg: "size-6 border-[2.5px]",
} as const;

/** Monochrome ring spinner; inherits text color so it works on ink and white buttons. */
export function Spinner({
  size = "md",
  className,
  label,
}: {
  size?: keyof typeof SIZE;
  className?: string;
  /** Announced to screen readers; omit when the surrounding text already says what is loading. */
  label?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent opacity-80 [animation-duration:700ms]",
        SIZE[size],
        className
      )}
    />
  );
}
