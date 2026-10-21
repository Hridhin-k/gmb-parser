import { addStarCounts, EMPTY_STARS, type DashboardFacts, type StarCounts } from "@/lib/metrics";

/** One review row used to count 1★–5★ inside a chart slice. */
export interface StarReview {
  stars: number;
  createdAt: string;
  locationId: string;
  groupId: string | null;
  theme: string | null;
}

export interface StarMaps {
  months: Map<string, StarCounts>;
  locations: Map<string, StarCounts>;
  groups: Map<string, StarCounts>;
  themes: Map<string, StarCounts>;
  themeGroups: Map<string, StarCounts>;
}

export function emptyStarMaps(): StarMaps {
  return {
    months: new Map(),
    locations: new Map(),
    groups: new Map(),
    themes: new Map(),
    themeGroups: new Map(),
  };
}

/** First day of the calendar month in the workspace timezone, matching the dashboard month key. */
export function monthKeyInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

function bump(map: Map<string, StarCounts>, key: string, stars: number, by = 1) {
  if (stars < 1 || stars > 5) return;
  const current = map.get(key) ?? EMPTY_STARS;
  const next = [...current] as StarCounts;
  next[stars - 1] += by;
  map.set(key, next);
}

/**
 * Count 1★–5★ for the slices the charts draw.
 * Theme slices follow the complaint charts: only 1–3 star reviews, and a missing theme is "unspecified".
 */
export function tallyStarReviews(rows: StarReview[], timeZone: string): StarMaps {
  const maps = emptyStarMaps();
  for (const row of rows) {
    const month = monthKeyInZone(row.createdAt, timeZone);
    if (month) bump(maps.months, month, row.stars);
    bump(maps.locations, row.locationId, row.stars);
    bump(maps.groups, row.groupId ?? "", row.stars);
    if (row.stars <= 3) {
      const theme = row.theme && row.theme.length > 0 ? row.theme : "unspecified";
      if (month) bump(maps.themes, `${month}\t${theme}`, row.stars);
      bump(maps.themeGroups, `${row.groupId ?? ""}\t${theme}`, row.stars);
    }
  }
  return maps;
}

/** One pre-aggregated slice from `grm_star_breakdown`: reviews already counted in SQL. */
export interface StarAggregate {
  /** First day of the month in the workspace timezone, `yyyy-mm-dd`. */
  month: string;
  locationId: string;
  groupId: string | null;
  stars: number;
  theme: string | null;
  count: number;
}

/**
 * Same result as `tallyStarReviews`, but from SQL-aggregated counts. This is
 * what lets the dashboard avoid downloading every review row in the window.
 */
export function tallyStarAggregates(rows: StarAggregate[]): StarMaps {
  const maps = emptyStarMaps();
  for (const row of rows) {
    if (row.count <= 0) continue;
    if (row.month) bump(maps.months, row.month, row.stars, row.count);
    bump(maps.locations, row.locationId, row.stars, row.count);
    bump(maps.groups, row.groupId ?? "", row.stars, row.count);
    if (row.stars >= 1 && row.stars <= 3) {
      const theme = row.theme && row.theme.length > 0 ? row.theme : "unspecified";
      if (row.month) bump(maps.themes, `${row.month}\t${theme}`, row.stars, row.count);
      bump(maps.themeGroups, `${row.groupId ?? ""}\t${theme}`, row.stars, row.count);
    }
  }
  return maps;
}

export function sumStarCounts(rows: Array<StarCounts | undefined>): StarCounts | undefined {
  if (rows.length === 0 || rows.some((row) => !row)) return undefined;
  return rows.reduce<StarCounts>((total, row) => addStarCounts(total, row!), EMPTY_STARS);
}

/** Copy star counts onto the slices the dashboard already aggregated. */
export function applyStarBreakdown(facts: DashboardFacts, maps: StarMaps): DashboardFacts {
  return {
    ...facts,
    months: facts.months.map((month) => ({
      ...month,
      stars: maps.months.get(month.month.slice(0, 10)) ?? EMPTY_STARS,
    })),
    locations: facts.locations.map((row) => ({
      ...row,
      stars: maps.locations.get(row.locationId) ?? EMPTY_STARS,
    })),
    groups: facts.groups.map((row) => ({
      ...row,
      stars: maps.groups.get(row.groupId ?? "") ?? EMPTY_STARS,
    })),
    themeMonths: facts.themeMonths.map((row) => ({
      ...row,
      stars: maps.themes.get(`${row.month.slice(0, 10)}\t${row.theme}`) ?? EMPTY_STARS,
    })),
    themeGroups: facts.themeGroups.map((row) => ({
      ...row,
      stars: maps.themeGroups.get(`${row.groupId ?? ""}\t${row.theme}`) ?? EMPTY_STARS,
    })),
  };
}
