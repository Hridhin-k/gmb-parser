import { resolveScope, type ScopeCatalog, type ScopeRequest } from "@/lib/scope";
import { membershipHash, type IntelligenceScopeType } from "@/lib/intelligence/identity";

export class SummaryAccessError extends Error {
  constructor(message = "This scope is not available to the signed-in member") {
    super(message);
    this.name = "SummaryAccessError";
  }
}

export interface AuthorizedSummaryScope {
  workspaceId: string;
  clientId: string;
  scopeType: IntelligenceScopeType;
  scopeId: string;
  groupId: string | null;
  locationId: string | null;
  placedGroupId: string | null;
  parentGroupId: string | null;
  label: string;
  locationIds: string[];
  membershipHash: string;
}

/**
 * The only scope decision summaries use. Client, group, and location ids are
 * accepted only after they resolve inside this tenant and inside the member's
 * lock. A request that names a place the member cannot see is refused.
 * It is not rewritten to a wider scope.
 */
export function authorizeSummaryScope(catalog: ScopeCatalog, request: ScopeRequest): AuthorizedSummaryScope {
  if (catalog.lock.clientId === "00000000-0000-0000-0000-000000000000" || catalog.lock.locationId === "00000000-0000-0000-0000-000000000000") {
    throw new SummaryAccessError();
  }
  const resolved = resolveScope(catalog, request);
  if (resolved.blocked || resolved.dropped || !resolved.clientId) throw new SummaryAccessError();
  if (resolved.clientId === "00000000-0000-0000-0000-000000000000") throw new SummaryAccessError();
  const scopeId =
    resolved.level === "location" ? resolved.locationId : resolved.level === "group" ? resolved.groupId : resolved.clientId;
  if (!scopeId) throw new SummaryAccessError();
  const location = resolved.level === "location" ? catalog.locations.find((item) => item.id === resolved.locationId) : null;
  const group = resolved.level === "group" ? catalog.groups.find((item) => item.id === resolved.groupId) : null;
  return {
    workspaceId: catalog.workspaceId,
    clientId: resolved.clientId,
    scopeType: resolved.level,
    scopeId,
    groupId: resolved.level === "group" ? resolved.groupId : null,
    locationId: resolved.level === "location" ? resolved.locationId : null,
    placedGroupId: location?.groupId ?? null,
    parentGroupId: group?.parentId ?? null,
    label: resolved.title,
    locationIds: [...resolved.locationIds].sort(),
    membershipHash: membershipHash(resolved.locationIds),
  };
}
