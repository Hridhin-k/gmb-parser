/** Analytics tab ids — shared by the server page and the client board. */
export const ANALYTICS_SECTIONS = [
  { id: "performance", label: "Performance" },
  { id: "themes", label: "Themes" },
  { id: "profile", label: "Google profile" },
  { id: "automation", label: "Automation health" },
  { id: "team", label: "Team" },
] as const;

export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number]["id"];
