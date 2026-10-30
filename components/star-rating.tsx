import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Ratings use one amber star colour; status colours stay reserved for status. */
export function starFillClass(rating: number): string {
  void rating;
  return "fill-star text-star";
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
          className={cn(SIZE[size], i < rating ? starFillClass(rating) : "fill-[#d6dae1] text-[#d6dae1]")}
          aria-hidden
        />
      ))}
    </div>
  );
}
