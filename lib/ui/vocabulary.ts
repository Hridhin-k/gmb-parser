/**
 * User-facing vocabulary for the redesign. Storage names stay as they are
 * (client, group, location; role ids) — only what people read changes.
 *
 *   Workspace  the account you sign in to (tenant)
 *   Business   a company managed in the workspace (stored as client)
 *   Group      an optional folder of locations (region, brand, franchisee)
 *   Location   one Google Business Profile (stored as location / outlet)
 */
export const TERMS = {
  workspace: "Workspace",
  business: "Business",
  businesses: "Businesses",
  group: "Group",
  groups: "Groups",
  location: "Location",
  locations: "Locations",
} as const;

/** Map labels produced by lib/scope ("Organisation", "Outlet") to the new terms. */
export function scopeKindLabel(kind: string): string {
  switch (kind) {
    case "Organisation":
    case "organisation":
      return TERMS.business;
    case "Outlet":
    case "outlet":
    case "location":
      return TERMS.location;
    case "Group":
    case "group":
      return TERMS.group;
    default:
      return kind;
  }
}

/** Rewrite legacy words inside a sentence that comes from shared helpers. */
export function modernizeCopy(text: string): string {
  return text
    .replace(/\bAll organisations\b/g, "All businesses")
    .replace(/\bOrganisations\b/g, "Businesses")
    .replace(/\borganisations\b/g, "businesses")
    .replace(/\bOrganisation\b/g, "Business")
    .replace(/\borganisation\b/g, "business")
    .replace(/\bOutlets\b/g, "Locations")
    .replace(/\boutlets\b/g, "locations")
    .replace(/\bOutlet\b/g, "Location")
    .replace(/\boutlet\b/g, "location");
}

/** Role names as people see them. Role ids are unchanged. */
export function roleName(role: string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "org_admin":
    case "admin":
      return "Workspace admin";
    case "brand_manager":
      return "Business manager";
    case "group_manager":
      return "Regional manager";
    case "store_manager":
      return "Store manager";
    case "agent":
      return "Responder";
    case "auditor":
      return "Viewer";
    case "member":
      return "Responder (drafts only)";
    default:
      return "Member";
  }
}

/** One-line description of what a role can do, for pickers and help text. */
export function roleSummary(role: string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Everything, including billing and deleting the workspace.";
    case "org_admin":
    case "admin":
      return "Settings, team and locations across the workspace.";
    case "brand_manager":
      return "Approve, publish and escalate for one business.";
    case "group_manager":
      return "Approve, publish and escalate within their groups.";
    case "store_manager":
      return "Reply and approve for their location.";
    case "agent":
      return "Draft and reply to reviews in scope.";
    case "auditor":
      return "Read-only access to reviews, analytics and reports.";
    case "member":
      return "Draft with AI and submit for approval; can't publish.";
    default:
      return "";
  }
}
