/** Filled-star color: 4–5 green, 3 yellow, 1–2 red. */
export function ratingStarClass(rating: number): string {
  if (rating >= 4) return "fill-[#16a34a] text-[#16a34a]";
  if (rating >= 3) return "fill-[#eab308] text-[#eab308]";
  if (rating > 0) return "fill-[#dc2626] text-[#dc2626]";
  return "fill-[#e4e2de] text-[#e4e2de]";
}

export function ratingTextClass(rating: number): string {
  if (rating >= 4) return "text-[#16a34a]";
  if (rating >= 3) return "text-[#ca8a04]";
  if (rating > 0) return "text-[#dc2626]";
  return "text-[#898b91]";
}

export function ratingBarClass(star: number): string {
  if (star >= 4) return "bg-[#16a34a]";
  if (star === 3) return "bg-[#eab308]";
  return "bg-[#dc2626]";
}
