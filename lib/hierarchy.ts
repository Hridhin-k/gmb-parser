import type { ToneVoice } from "@/lib/onboarding";

export const GROUP_KINDS = [
  { id: "region", label: "Region" },
  { id: "city", label: "City" },
] as const;

export type GroupKind = (typeof GROUP_KINDS)[number]["id"];

export const ROUTING_LEVELS = [
  { id: "store", label: "Store" },
  { id: "regional", label: "Regional" },
  { id: "leadership", label: "Leadership" },
] as const;

export type RoutingLevel = (typeof ROUTING_LEVELS)[number]["id"];

export interface SettingFields {
  toneVoice: ToneVoice | null;
  toneNote: string | null;
  slaHours: number | null;
  routingLevel: RoutingLevel | null;
  draftsPaused: boolean | null;
}

export interface SettingNode {
  id: string;
  label: string;
  fields: SettingFields;
}

export interface ResolvedField<T> {
  value: T;
  source: string;
  overridden: boolean;
}

export function emptyFields(): SettingFields {
  return { toneVoice: null, toneNote: null, slaHours: null, routingLevel: null, draftsPaused: null };
}

/** The first node is the place being viewed. A value there is an override. */
export function describeSetting<T>(
  chain: SettingNode[],
  pick: (fields: SettingFields) => T | null,
  fallback: { value: T; source: string }
): ResolvedField<T> {
  const here = chain[0];
  const own = here ? pick(here.fields) : null;
  if (here && own !== null && own !== undefined) {
    return { value: own, source: here.label, overridden: true };
  }
  for (const node of chain.slice(1)) {
    const value = pick(node.fields);
    if (value !== null && value !== undefined) {
      return { value, source: node.label, overridden: false };
    }
  }
  return { value: fallback.value, source: fallback.source, overridden: false };
}

export function groupIdsInScope(
  selectedId: string,
  groups: Array<{ id: string; parentId: string | null }>
): string[] {
  return groups.filter((group) => group.id === selectedId || group.parentId === selectedId).map((group) => group.id);
}

export function locationInGroup(
  locationGroupId: string | null,
  selectedId: string | null,
  groups: Array<{ id: string; parentId: string | null }>
): boolean {
  if (!selectedId) return true;
  if (!locationGroupId) return false;
  return groupIdsInScope(selectedId, groups).includes(locationGroupId);
}

export interface GroupShape {
  id?: string;
  workspaceId: string;
  clientId: string | null;
  kind: GroupKind;
  parent: {
    id: string;
    workspaceId: string;
    clientId: string | null;
    kind: GroupKind;
    parentId: string | null;
  } | null;
}

export function groupShapeError(input: GroupShape): string | null {
  if (input.parent) {
    if (input.id && input.parent.id === input.id) return "A group cannot be its own parent.";
    if (input.parent.workspaceId !== input.workspaceId) return "A group cannot belong to another organization.";
    if (input.parent.parentId) return "A city cannot contain another group.";
    if (input.parent.kind !== "region") return "A city belongs under a region.";
    if (input.kind !== "city") return "Only a city can sit under a region.";
    if (input.parent.clientId !== input.clientId) return "A city must belong to the same brand as its region.";
    return null;
  }
  if (input.kind === "city") return "A city needs a region.";
  return null;
}

export function locationMoveError(input: {
  locationWorkspaceId: string;
  groupWorkspaceId: string;
  locationClientId: string | null;
  groupClientId: string | null;
}): string | null {
  if (input.locationWorkspaceId !== input.groupWorkspaceId) {
    return "That group is not in this organization.";
  }
  if (input.groupClientId && input.locationClientId && input.groupClientId !== input.locationClientId) {
    return "That group belongs to another brand.";
  }
  return null;
}

export function mergeGroupsError(input: {
  source: { id: string; kind: GroupKind; clientId: string | null; parentId: string | null };
  target: { id: string; kind: GroupKind; clientId: string | null; parentId: string | null };
}): string | null {
  if (input.source.id === input.target.id) return "Choose two different groups.";
  if (input.source.clientId !== input.target.clientId) return "Groups from different brands cannot be merged.";
  if (input.source.kind === "region" && input.target.kind === "city") return "A region cannot be merged into a city.";
  return null;
}

export interface ConnectionInput {
  connectionStatus: "active" | "expired" | "revoked" | null;
  isActive: boolean;
  holdReason: "duplicate" | "unverified" | null;
  voiceOfMerchant: boolean | null;
  googleDuplicateOf: string | null;
  sharedPlace: boolean;
}

export interface ConnectionView {
  label: string;
  kind: "connected" | "expired" | "paused" | "duplicate" | "unverified" | "unknown";
  href: string | null;
}

export function connectionView(input: ConnectionInput): ConnectionView {
  const expired = input.connectionStatus === "expired" || input.connectionStatus === "revoked";
  if (input.holdReason === "duplicate" || input.googleDuplicateOf || input.sharedPlace) {
    return {
      label: input.holdReason === "duplicate" && !input.googleDuplicateOf && !input.sharedPlace ? "Marked duplicate" : "Possible duplicate",
      kind: "duplicate",
      href: expired ? "/settings" : null,
    };
  }
  if (input.connectionStatus === "expired" || input.connectionStatus === "revoked") {
    return { label: "Access expired", kind: "expired", href: "/settings" };
  }
  if (!input.isActive) return { label: "Paused", kind: "paused", href: null };
  if (input.holdReason === "unverified" || input.voiceOfMerchant === false) {
    return { label: "Unverified", kind: "unverified", href: null };
  }
  if (input.connectionStatus === "active") return { label: "Connected", kind: "connected", href: null };
  return { label: "No Google connection", kind: "unknown", href: "/settings" };
}

export function sharedPlaceIds(locations: Array<{ id: string; placeId: string | null }>): Set<string> {
  const counts = new Map<string, number>();
  for (const location of locations) {
    const place = location.placeId?.trim();
    if (!place) continue;
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([place]) => place));
}
