import type { DashboardFacts } from "@/lib/metrics";
import { themeLabel } from "@/lib/review-inbox";

export interface ScoredOutlet {
  id: string;
  name: string;
  reviews: number;
  rating: number;
  oneToThree: number;
}

/** Aggregate theme_groups rows into labeled totals for evidence charts. */
export function themeRowsFromGroups(
  themeGroups: Array<{ theme: string; count: number }>
): Array<{ label: string; count: number }> {
  const totals = new Map<string, number>();
  for (const row of themeGroups) {
    totals.set(row.theme, (totals.get(row.theme) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .map(([theme, count]) => ({ label: themeLabel(theme) ?? theme, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** Rank outlets by their own average. A single outlet has no comparison. */
export function outletComparison(
  places: Array<{ id: string; name: string }>,
  locations: DashboardFacts["locations"]
): { strongest: ScoredOutlet | null; weakest: ScoredOutlet | null } {
  const byId = new Map(locations.map((row) => [row.locationId, row]));
  const scored = places
    .map((place) => {
      const row = byId.get(place.id);
      if (!row || row.reviews <= 0) return null;
      return {
        id: place.id,
        name: place.name,
        reviews: row.reviews,
        rating: row.ratingSum / row.reviews,
        oneToThree: row.oneToThree,
      };
    })
    .filter((row): row is ScoredOutlet => row !== null)
    .sort((a, b) => b.rating - a.rating || b.reviews - a.reviews || a.name.localeCompare(b.name));

  const strongest = scored[0] ?? null;
  const weakest = scored.length > 1 ? scored[scored.length - 1]! : null;
  if (strongest && weakest && strongest.id === weakest.id) {
    return { strongest, weakest: null };
  }
  return { strongest, weakest };
}

/** Count sentences saved when the model did not return an interpretation. */
export function isCountedSummary(summary: string): boolean {
  return (
    summary.includes("AI unavailable") ||
    /covers \d+ locations? with \d+ recent reviews?/.test(summary) ||
    /has \d+ locations? but no synced reviews yet/.test(summary) ||
    /has no synced reviews yet/.test(summary) ||
    /has \d+ reviews?(?: averaging [\d.]+★)?\. \d+ positive, \d+ need attention/.test(summary)
  );
}
