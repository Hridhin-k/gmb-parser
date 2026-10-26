import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fill colour for a 1–5 rating. 4–5 green, 3 yellow, 1–2 red. */
export function starFillClass(rating: number): string {
  if (rating >= 4) return "fill-green-500 text-green-500";
  if (rating >= 3) return "fill-yellow-400 text-yellow-500";
  return "fill-red-500 text-red-500";
}

const SIZE = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
} as const;

const GAP = {
  sm: "gap-px",
  md: "gap-0.5",
} as const;

export function StarRating({
  rating,
  size = "sm",
}: {
  rating: number;
  /** sm matches inbox cards. md matches the review detail panel. */
  size?: keyof typeof SIZE;
}) {
  return (
    <div className={cn("flex items-center", GAP[size])} aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(SIZE[size], i < rating ? starFillClass(rating) : "fill-silver text-silver")}
          aria-hidden
        />
      ))}
    </div>
  );
}
