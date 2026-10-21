import { type DashboardFacts, type StarCounts } from "@/lib/metrics";
import { sumStarCounts } from "@/lib/star-breakdown";
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
  themeGroups: Array<{ theme: string; count: number; stars?: StarCounts }>
): Array<{ label: string; count: number; stars?: StarCounts }> {
  const totals = new Map<string, number>();
  const starRows = new Map<string, Array<StarCounts | undefined>>();
  for (const row of themeGroups) {
    totals.set(row.theme, (totals.get(row.theme) ?? 0) + row.count);
    const list = starRows.get(row.theme) ?? [];
    list.push(row.stars);
    starRows.set(row.theme, list);
  }
  return [...totals.entries()]
    .map(([theme, count]) => ({
      label: themeLabel(theme) ?? theme,
      count,
      stars: sumStarCounts(starRows.get(theme) ?? []),
    }))
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

/** A finding stays visible only when every location it cites is inside the selected scope. */
export function findingsForScope<T extends { locationIds: readonly string[] }>(
  findings: readonly T[],
  locationIds: readonly string[]
): T[] {
  const allowed = new Set(locationIds);
  return findings.filter((finding) => finding.locationIds.length === 0 || finding.locationIds.every((id) => allowed.has(id)));
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
