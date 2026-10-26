/** Null share renders as an em dash. 0.426 → "43%". */
export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
