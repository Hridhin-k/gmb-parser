export interface OverviewSignalsData {
  themes: Array<{ locationId: string; theme: string; count: number }>;
  themesTruncated: boolean;
  complaints: Array<{ locationId: string; topic: string; count: number }>;
  recentNegative: { locationId: string; count: number; fromDay: string; toDay: string } | null;
  oldestOverdue: { id: string; dueAt: string; locationId: string } | null;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Turns the `grm_overview_signals` JSON into overview signals. Full counts — never truncated. */
export function signalsFromRpc(
  raw: unknown,
  input: { since48: string; now: Date }
): OverviewSignalsData {
  const body = obj(raw);
  const themes = Array.isArray(body.themes)
    ? body.themes.flatMap((item) => {
        const row = obj(item);
        if (typeof row.locationId !== "string" || typeof row.theme !== "string") return [];
        return [{ locationId: row.locationId, theme: row.theme, count: num(row.count) }];
      })
    : [];
  const complaints = Array.isArray(body.complaints)
    ? body.complaints.flatMap((item) => {
        const row = obj(item);
        if (typeof row.locationId !== "string" || typeof row.topic !== "string" || row.topic.length === 0) return [];
        return [{ locationId: row.locationId, topic: row.topic, count: num(row.count) }];
      })
    : [];

  const recentTop = body.recentTop ? obj(body.recentTop) : null;
  const recentCount = recentTop ? num(recentTop.count) : 0;
  const recentLocation = recentTop && typeof recentTop.locationId === "string" ? recentTop.locationId : null;

  const overdue = body.oldestOverdue ? obj(body.oldestOverdue) : null;

  return {
    themes,
    themesTruncated: false,
    complaints,
    recentNegative:
      recentLocation && recentCount >= 3
        ? {
            locationId: recentLocation,
            count: recentCount,
            fromDay: input.since48.slice(0, 10),
            toDay: input.now.toISOString().slice(0, 10),
          }
        : null,
    oldestOverdue:
      overdue && typeof overdue.id === "string" && typeof overdue.locationId === "string"
        ? {
            id: overdue.id,
            dueAt: typeof overdue.dueAt === "string" ? overdue.dueAt : "",
            locationId: overdue.locationId,
          }
        : null,
  };
}

export const EMPTY_OVERVIEW_SIGNALS: OverviewSignalsData = {
  themes: [],
  themesTruncated: false,
  complaints: [],
  recentNegative: null,
  oldestOverdue: null,
};
