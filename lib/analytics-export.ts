import {
  formatHours,
  rankRows,
  rollupByGroup,
  type RankBy,
  type RankShow,
} from "@/lib/analytics-metrics";
import { average, share, type DashboardFacts } from "@/lib/metrics";

export interface LeaderboardExportInput {
  facts: DashboardFacts;
  locationNames: Map<string, string>;
  groupNames: Map<string, string>;
  groupOf: (locationId: string) => string | null;
  parentOf: (groupId: string) => string | null;
  rankBy: RankBy;
  show: RankShow;
}

export interface LeaderboardExportRow {
  rank: number;
  name: string;
  group: string | null;
  rating: number | null;
  reviews: number;
  replyRate: number | null;
  replyHours: number | null;
}

/** Same ranking as the Analytics Performance leaderboard table. */
export function buildLeaderboardExportRows(input: LeaderboardExportInput): LeaderboardExportRow[] {
  const { facts, locationNames, groupNames, groupOf, parentOf, rankBy, show } = input;
  const ranked =
    show === "groups"
      ? rankRows(
          rollupByGroup(
            facts.locations
              .filter((row) => locationNames.has(row.locationId))
              .map((row) => ({
                id: row.locationId,
                groupId: groupOf(row.locationId),
                reviews: row.reviews,
                ratingSum: row.ratingSum,
                replied: row.replied,
                responseHoursSum: row.responseHoursSum,
                responseCount: row.responseCount,
              })),
            parentOf
          ),
          rankBy
        )
      : rankRows(
          facts.locations
            .filter((row) => locationNames.has(row.locationId))
            .map((row) => ({
              id: row.locationId,
              reviews: row.reviews,
              ratingSum: row.ratingSum,
              replied: row.replied,
              responseHoursSum: row.responseHoursSum,
              responseCount: row.responseCount,
            })),
          rankBy
        );

  return ranked.map((row, index) => {
    const directGroup = show === "locations" ? groupOf(row.id) : null;
    const groupId =
      show === "groups" ? row.id || null : directGroup ? parentOf(directGroup) ?? directGroup : null;
    const name =
      show === "groups"
        ? groupNames.get(row.id) ?? (row.id ? "Removed group" : "No group")
        : locationNames.get(row.id) ?? "Removed location";
    return {
      rank: index + 1,
      name,
      group: show === "locations" ? (groupId ? groupNames.get(groupId) ?? "Removed group" : null) : null,
      rating: row.reviews > 0 ? row.ratingSum / row.reviews : null,
      reviews: row.reviews,
      replyRate: share(row.replied, row.reviews),
      replyHours: average(row.responseHoursSum, row.responseCount),
    };
  });
}

/** CSV matrix for the Analytics leaderboard (header + data rows). */
export function leaderboardExportLines(
  rows: LeaderboardExportRow[],
  show: RankShow
): string[][] {
  const header =
    show === "groups"
      ? ["Rank", "Group", "Rating", "Reviews", "Reply rate", "Reply time"]
      : ["Rank", "Location", "Group", "Rating", "Reviews", "Reply rate", "Reply time"];

  return [
    header,
    ...rows.map((row) => {
      const rating = row.rating === null ? "" : row.rating.toFixed(2);
      const replyRate = row.replyRate === null ? "" : `${Math.round(row.replyRate * 100)}%`;
      const replyTime = row.replyHours === null ? "" : formatHours(row.replyHours);
      if (show === "groups") {
        return [String(row.rank), row.name, rating, String(row.reviews), replyRate, replyTime];
      }
      return [
        String(row.rank),
        row.name,
        row.group ?? "",
        rating,
        String(row.reviews),
        replyRate,
        replyTime,
      ];
    }),
  ];
}
