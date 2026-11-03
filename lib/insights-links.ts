type Params = Record<string, string | string[] | undefined>;

/** Place and dates: the params every Insights link carries over. */
const KEPT = ["client", "group", "location", "range", "from", "to"] as const;

const REPORT_VIEWS = new Set(["alerts", "history", "failures"]);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function build(params: Params, extra: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const key of KEPT) {
    const value = first(params[key]);
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  const text = query.toString();
  return `/insights${text ? `?${text}` : ""}`;
}

/** Old /analytics links: the themes section opens Topics, everything else the Summary. */
export function analyticsRedirect(params: Params): string {
  return build(params, { tab: first(params.section) === "themes" ? "topics" : undefined });
}

/** Old /reports links open Insights → Reports and alerts, on the same section and edit drawer. */
export function reportsRedirect(params: Params): string {
  const view = first(params.tab);
  return build(params, {
    tab: "reports",
    view: view && REPORT_VIEWS.has(view) ? view : undefined,
    edit: first(params.edit),
  });
}
